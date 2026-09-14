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
 * circle also completes; the trailing star toggles the local star. Dispatches
 * `task-complete`, `task-snooze` (detail: { due }) and `task-star` (detail:
 * { taskId }) for the controller to act on.
 */
@customElement('task-card')
export class TaskCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      /* Clip the swipe reveal to the exact row bounds so no colour bleeds past
         the row edges. Rows are square (no radius) and edge-to-edge. */
      overflow: hidden;
      background: var(--app-surface);
      border-bottom: 1px solid var(--app-border);
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
      transition: transform 0.24s cubic-bezier(0.2, 0, 0, 1);
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
    .body {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .title {
      font-size: 1rem;
      font-weight: 600;
      line-height: 1.3;
      color: var(--app-on-surface);
      word-break: break-word;
    }
    .meta {
      display: flex;
      align-items: baseline;
      gap: 8px;
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
    .list {
      font-size: 0.72rem;
      color: var(--app-on-surface-muted);
      opacity: 0.85;
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
    .star {
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
    .star:hover {
      background: color-mix(in srgb, var(--app-on-surface) 8%, transparent);
    }
    .star:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: -2px;
    }
    .star.on {
      color: var(--app-star);
    }
    .star svg {
      width: 22px;
      height: 22px;
      fill: currentColor;
    }
  `;

  @property({ attribute: false }) task!: Task;
  @property({ type: Boolean }) starred = false;

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
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    return due.slice(0, 10) < todayStr;
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

  private onStarToggle = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('task-star', {
        detail: { taskId: this.task.id },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private flyOutAndComplete(): void {
    const w = this.width();
    this.animating = true;
    this.offset = w * 1.15;
    this.afterTransition(() => {
      this.dispatchEvent(
        new CustomEvent('task-complete', {
          detail: { task: this.task },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }

  private openSnooze(): void {
    // Spring the card back to rest, then raise the menu.
    this.offset = 0;
    this.snoozeOptions = computeSnoozeOptions(new Date(), { overdue: this.isOverdue });
    this.snoozeOpen = true;
  }

  private onSnoozePick = (e: CustomEvent<SnoozeOption>) => {
    e.stopPropagation();
    this.snoozeOpen = false;
    const due = e.detail.date;
    this.animating = true;
    const w = this.width();
    this.offset = -w * 1.15;
    this.afterTransition(() => {
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

  /** Run `fn` once the front's transform transition ends (with a fallback). */
  private afterTransition(fn: () => void): void {
    const front = this.renderRoot.querySelector('.front') as HTMLElement | null;
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      fn();
    };
    if (front) {
      front.addEventListener('transitionend', run, { once: true });
    }
    // Fallback in case transitionend doesn't fire (reduced motion, no layout).
    setTimeout(run, 320);
  }

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
            <span class="list">${this.task?.taskListTitle}</span>
          </div>
          ${this.task?.notes ? html`<div class="notes">${this.task.notes}</div>` : ''}
        </div>
        <button
          class="star ${this.starred ? 'on' : ''}"
          type="button"
          aria-label=${this.starred ? 'Unstar task' : 'Star task'}
          aria-pressed=${this.starred}
          @pointerdown=${this.stopDrag}
          @click=${this.onStarToggle}
        >
          ${this.starred
            ? html`<svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
                />
              </svg>`
            : html`<svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"
                />
              </svg>`}
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
