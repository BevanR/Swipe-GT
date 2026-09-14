import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { SnoozeOption, Task } from '../types';
import { computeSnoozeOptions } from '../logic/snooze';
import { formatDueLabel } from '../logic/dueLabel';
import { decideSwipe, isHorizontalSwipe, isVerticalScroll } from './swipe';
import './snooze-menu.js';

/**
 * A single swipeable, full-bleed task row. Hand-rolled pointer-drag (no gesture
 * lib): drag right past threshold → Complete (green reveal, optimistic fly-out),
 * drag left past threshold → open the Snooze menu (amber reveal). The leading
 * circle also completes. Dispatches `task-complete` and `task-snooze` (detail:
 * { due }) for the controller to act on.
 *
 * The row stays full-bleed in both themes; the Inbox vs Tasks look is driven by
 * theme tokens consumed here (`--app-row-*`): Inbox rows get elevation, rounded
 * corners and a gap (grouped white cards on a soft grey ground), while Tasks
 * rows are flat, flush and divided by a hairline (denser).
 */
@customElement('task-card')
export class TaskCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      /* Clip the swipe reveal to the exact row bounds so no colour bleeds past
         the row edges. Corner radius / divider / elevation are theme-driven. */
      overflow: hidden;
      background: var(--app-surface);
      border-bottom: var(--app-row-border, 1px solid var(--app-border));
      border-radius: var(--app-row-radius, 0);
      box-shadow: var(--app-row-shadow, none);
      margin-bottom: var(--app-row-gap, 0);
      touch-action: pan-y;
    }
    /* Revealed action layers, behind the sliding front. They fill the row
       exactly; :host overflow:hidden clips them to the row. */
    .action {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 20px;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .action.complete {
      justify-content: flex-start;
      background: var(--app-complete);
      color: var(--app-complete-on);
    }
    .action.snooze {
      justify-content: flex-end;
      background: var(--app-snooze);
      color: var(--app-snooze-on);
    }
    .action svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
      flex: none;
    }
    /* The bare \`hidden\` attribute is overridden by \`.action { display: flex }\`
       (equal specificity, author wins), so an explicit rule is needed or BOTH
       reveal layers paint and the last one (snooze/amber) covers the green. */
    .action[hidden] {
      display: none;
    }
    .front {
      position: relative;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: var(--app-card-pad);
      background: var(--app-surface);
      color: var(--app-on-surface);
      will-change: transform;
      transform: translateX(0);
      user-select: none;
      -webkit-user-select: none;
    }
    /* Orange accent bar for overdue rows (drawn inset so it never shifts text). */
    .front.overdue {
      box-shadow: inset 4px 0 0 var(--app-warning-accent);
    }
    .front.animating {
      transition: transform 0.15s cubic-bezier(0.2, 0, 0, 1);
    }
    .circle {
      appearance: none;
      flex: none;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid var(--app-checkbox-border);
      background: transparent;
      color: transparent;
      cursor: pointer;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .circle:hover {
      border-color: var(--app-complete);
    }
    .circle:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: 2px;
    }
    .circle .check {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
    .circle.done {
      background: var(--app-complete);
      border-color: var(--app-complete);
      color: #fff;
    }
    /* Explicit snooze button on the right of the row — always visible so desktop
       (no swipe) users can reach the same snooze menu the left-swipe opens.
       Mirrors the icon-button pattern (muted, hover background, accent focus)
       and is themed via tokens, so it works in both the inbox and tasks themes. */
    .snoozebtn {
      appearance: none;
      flex: none;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--app-on-surface-muted);
      cursor: pointer;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .snoozebtn:hover {
      background: color-mix(in srgb, var(--app-on-surface) 8%, transparent);
    }
    .snoozebtn:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: 2px;
    }
    .snoozebtn svg {
      width: 22px;
      height: 22px;
      fill: currentColor;
    }
    .body {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--app-body-gap, 2px);
    }
    .title {
      font-size: 1rem;
      font-weight: 600;
      line-height: var(--app-title-line, 1.3);
      color: var(--app-on-surface);
      word-break: break-word;
    }
    .meta {
      display: flex;
      align-items: baseline;
      gap: var(--app-meta-gap, 8px);
      flex-wrap: wrap;
    }
    .due {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--app-on-surface-muted);
    }
    .due.overdue {
      color: var(--app-warning);
      font-weight: 600;
    }
    .notes {
      margin-top: 2px;
      font-size: 0.8rem;
      color: var(--app-on-surface-muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    /* Reduced motion: make the swipe-settle and the collapse/fly-out instant.
       Shadow-DOM \`!important\` overrides even the inline height transition set
       by flyOutCollapse, so the row still removes correctly — the setTimeout
       that dispatches the complete/snooze event is JS and fires regardless. */
    @media (prefers-reduced-motion: reduce) {
      .front.animating {
        transition-duration: 0s;
      }
      :host {
        transition-duration: 0s !important;
      }
    }
  `;

  @property({ attribute: false }) task!: Task;
  /** The designated Someday list id (or null); threaded from the controller. */
  @property({ attribute: false }) somedayListId: string | null = null;

  @state() private offset = 0;
  @state() private animating = false;
  @state() private completing = false;
  @state() private snoozeOpen = false;
  @state() private snoozeOptions: SnoozeOption[] = [];

  private dragging = false;
  private axis: 'none' | 'h' | 'v' = 'none';
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private lastX = 0;
  private lastTime = 0;
  private pointerId: number | null = null;

  /** True when the task's due date is strictly before today (local calendar). */
  private get isOverdue(): boolean {
    const due = this.task?.due;
    if (!due) return false;
    return due.slice(0, 10) < this.todayStr();
  }

  /**
   * True only when the task has a due date that equals today (local calendar).
   * Null-due, future, and overdue tasks are all NOT due today.
   */
  private get isDueToday(): boolean {
    const due = this.task?.due;
    if (!due) return false;
    return due.slice(0, 10) === this.todayStr();
  }

  /**
   * True when this task is already a dateless task in the Someday list — the one
   * case where the "Someday" snooze option is pointless (it's already there).
   */
  private get isSomedayTask(): boolean {
    return (
      this.somedayListId != null &&
      this.task?.due == null &&
      this.task?.taskListId === this.somedayListId
    );
  }

  /** Today's local calendar date as 'YYYY-MM-DD'. */
  private todayStr(): string {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  }

  private width(): number {
    return this.getBoundingClientRect().width || this.offsetWidth || 320;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.snoozeOpen) return;
    if (e.button !== undefined && e.button !== 0) return; // left button / touch only
    this.dragging = true;
    this.axis = 'none';
    this.startX = this.lastX = e.clientX;
    this.startY = e.clientY;
    this.startTime = this.lastTime = e.timeStamp;
    this.pointerId = e.pointerId;
    this.animating = false;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;

    if (this.axis === 'none') {
      if (isVerticalScroll(dx, dy)) {
        // Let the page scroll; abandon this drag.
        this.dragging = false;
        return;
      }
      if (isHorizontalSwipe(dx, dy)) {
        this.axis = 'h';
        const front = this.renderRoot.querySelector('.front');
        if (front && this.pointerId != null) {
          try {
            (front as HTMLElement).setPointerCapture(this.pointerId);
          } catch {
            /* capture is best-effort */
          }
        }
      }
    }

    if (this.axis === 'h') {
      this.offset = dx;
      this.lastX = e.clientX;
      this.lastTime = e.timeStamp;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.axis !== 'h') {
      this.offset = 0;
      return;
    }
    const dx = e.clientX - this.startX;
    const dt = Math.max(1, e.timeStamp - this.lastTime || e.timeStamp - this.startTime);
    const velocity = (e.clientX - this.lastX) / dt;
    const { commit, direction } = decideSwipe(dx, this.width(), velocity);

    this.animating = true;
    if (commit && direction === 'right') {
      this.flyOutAndComplete();
    } else if (commit && direction === 'left') {
      this.openSnooze();
    } else {
      this.offset = 0;
    }
  };

  private onPointerCancel = () => {
    if (!this.dragging) return;
    this.dragging = false;
    this.animating = true;
    this.offset = 0;
  };

  /** Stop a button press from also starting a swipe drag. */
  private stopDrag = (e: Event) => {
    e.stopPropagation();
  };

  private onCircleComplete = (e: Event) => {
    e.stopPropagation();
    if (this.completing) return;
    this.completing = true;
    this.flyOutAndComplete();
  };

  private flyOutAndComplete(): void {
    this.flyOutCollapse('right', () => {
      this.dispatchEvent(
        new CustomEvent('task-complete', {
          detail: { task: this.task },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }

  /**
   * Slide the front out in `dir` (keeping the coloured reveal visible), then
   * collapse the row's height to 0 (snappy, ~150ms) so completing/snoozing
   * doesn't leave an empty gap, and finally fire `dispatch` for the controller
   * to drop the task. Under reduced motion the shadow-DOM rule zeroes the height
   * transition, but the setTimeout below still fires, so the row is removed
   * either way. (Later: hold this open with an Undo button before collapsing.)
   */
  private flyOutCollapse(dir: 'left' | 'right', dispatch: () => void): void {
    const startHeight = this.offsetHeight;
    this.animating = true;
    this.offset = (dir === 'right' ? 1 : -1) * this.width() * 1.15;
    // Pin the current height, force a reflow, then transition it to 0.
    this.style.height = `${startHeight}px`;
    this.style.transition = 'height 0.15s ease';
    void this.offsetHeight;
    requestAnimationFrame(() => {
      this.style.height = '0px';
    });
    window.setTimeout(dispatch, 170);
  }

  /** Explicit snooze button (desktop-friendly): same path as a left-swipe commit. */
  private onSnoozeButton = (e: Event) => {
    e.stopPropagation();
    if (this.snoozeOpen) return;
    this.openSnooze();
  };

  private openSnooze(): void {
    // Spring the card back to rest, then raise the menu.
    this.offset = 0;
    this.snoozeOptions = computeSnoozeOptions(new Date(), {
      includeToday: !this.isDueToday,
      includeSomeday: this.somedayListId != null && !this.isSomedayTask,
    });
    this.snoozeOpen = true;
  }

  private onSnoozePick = (e: CustomEvent<SnoozeOption>) => {
    e.stopPropagation();
    this.snoozeOpen = false;
    const opt = e.detail;
    // The "Someday" option is dateless and parks the task — dispatch a DISTINCT
    // event (task-someday) rather than task-snooze (which carries a due date).
    if (opt.key === 'someday') {
      this.flyOutCollapse('left', () => {
        this.dispatchEvent(
          new CustomEvent('task-someday', {
            detail: { task: this.task },
            bubbles: true,
            composed: true,
          }),
        );
      });
      return;
    }
    const due = opt.date as string;
    this.flyOutCollapse('left', () => {
      this.dispatchEvent(
        new CustomEvent('task-snooze', {
          detail: { task: this.task, due },
          bubbles: true,
          composed: true,
        }),
      );
    });
  };

  private onSnoozeCancel = (e: Event) => {
    e.stopPropagation();
    this.snoozeOpen = false;
    this.animating = true;
    this.offset = 0;
  };

  render() {
    const revealComplete = this.offset > 0;
    const revealSnooze = this.offset < 0;
    const due = this.task?.due ?? null;
    const overdue = this.isOverdue;
    return html`
      <div class="action complete" aria-hidden="true" ?hidden=${!revealComplete}>
        <svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>
        <span>Complete</span>
      </div>
      <div class="action snooze" aria-hidden="true" ?hidden=${!revealSnooze}>
        <span>Snooze</span>
        <svg viewBox="0 0 24 24">
          <path
            d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm.5 8.2V7h-1.5v6l4.5 2.7.8-1.3-3.8-2.2z"
          />
        </svg>
      </div>
      <div
        class="front ${this.animating ? 'animating' : ''} ${overdue ? 'overdue' : ''}"
        style="transform: translateX(${this.offset}px)"
        role="group"
        aria-label=${`Task: ${this.task?.title ?? ''}. Swipe right to complete, left to snooze.`}
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerUp}
        @pointercancel=${this.onPointerCancel}
      >
        <button
          class="circle ${this.completing ? 'done' : ''}"
          type="button"
          aria-label=${`Complete task: ${this.task?.title ?? ''}`}
          @pointerdown=${this.stopDrag}
          @click=${this.onCircleComplete}
        >
          <svg class="check" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
          </svg>
        </button>
        <div class="body">
          <div class="title">${this.task?.title || '(untitled)'}</div>
          <div class="meta">
            ${due
              ? html`<span class="due ${overdue ? 'overdue' : ''}"
                  >${formatDueLabel(due, new Date())}</span
                >`
              : ''}
          </div>
          ${this.task?.notes ? html`<div class="notes">${this.task.notes}</div>` : ''}
        </div>
        <button
          class="snoozebtn"
          type="button"
          aria-label="Snooze task"
          @pointerdown=${this.stopDrag}
          @click=${this.onSnoozeButton}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M22 5.72l-4.6-3.86-1.29 1.53 4.6 3.86L22 5.72zM7.88 3.39L6.6 1.86 2 5.71l1.29 1.53 4.59-3.85zM12.5 8H11v6l4.75 2.85.75-1.23-4-2.37V8zM12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9c4.97 0 9-4.03 9-9s-4.03-9-9-9zm0 16c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"
            />
          </svg>
        </button>
      </div>
      <snooze-menu
        .options=${this.snoozeOptions}
        .open=${this.snoozeOpen}
        @snooze-pick=${this.onSnoozePick}
        @snooze-cancel=${this.onSnoozeCancel}
      ></snooze-menu>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'task-card': TaskCard;
  }
}
