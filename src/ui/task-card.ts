import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { SnoozeOption, Task } from '../types';
import { computeSnoozeOptions } from '../logic/snooze';
import { formatDueLabel } from '../logic/dueLabel';

/**
 * How a card shows its due date:
 *  - `'auto'` (default): the friendly relative label from `formatDueLabel`
 *    (the Now-view behaviour).
 *  - `'hidden'`: render no due text at all (used in Scheduled buckets whose
 *    header already states the day).
 *  - any other string: render that exact string (used for Scheduled range
 *    buckets, which show an absolute date).
 */
export type DueDisplay = 'auto' | 'hidden' | (string & {});
import { decideSwipe, isHorizontalSwipe, isVerticalScroll } from './swipe';
import { UndoTimer } from './undo';
import './snooze-menu.js';

/**
 * Max pointer travel (px) still counted as a tap rather than a drag. Kept at the
 * axis-lock deadzone so a movement that never locked to the horizontal axis (and
 * so never became a swipe) still reads as a tap only when it barely moved.
 */
const TAP_MOVE_SLOP = 8;

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
    /* Keyboard selection highlight (desktop): a subtle tinted ground plus an
       inset accent ring, drawn from existing tokens so it works in both themes.
       Purely additive — pointer/swipe users never see it. */
    :host([selected]) {
      background: color-mix(in srgb, var(--app-accent) 10%, var(--app-surface));
      box-shadow:
        var(--app-row-shadow, none),
        inset 0 0 0 2px var(--app-accent);
    }
    :host([selected]) .front {
      background: transparent;
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
    /* While an Undo window is open the green bar holds a "Completed" label and a
       real Undo button, pushed to the trailing edge (over the green). */
    .action.complete.undo {
      justify-content: flex-end;
    }
    .action.complete .completed-label {
      font-weight: 600;
    }
    /* Undo button: solid white on the green bar for high contrast, clearly a
       tappable control and keyboard-activatable. */
    .action.complete .undo-btn {
      appearance: none;
      flex: none;
      border: none;
      border-radius: 999px;
      padding: 6px 16px;
      font: inherit;
      font-weight: 700;
      line-height: 1;
      background: var(--app-complete-on);
      color: var(--app-complete);
      cursor: pointer;
    }
    .action.complete .undo-btn:hover {
      background: color-mix(in srgb, var(--app-complete-on) 90%, #000);
    }
    .action.complete .undo-btn:focus-visible {
      outline: 2px solid var(--app-complete-on);
      outline-offset: 2px;
    }
    /* Subtle 2s countdown: a hairline that shrinks along the bottom of the bar,
       matching UNDO_WINDOW_MS. Purely decorative, so reduced motion hides it. */
    .action.complete .undo-progress {
      position: absolute;
      left: 0;
      bottom: 0;
      height: 3px;
      width: 100%;
      transform-origin: left center;
      background: color-mix(in srgb, var(--app-complete-on) 55%, transparent);
      animation: undo-countdown 2s linear forwards;
    }
    @keyframes undo-countdown {
      from {
        transform: scaleX(1);
      }
      to {
        transform: scaleX(0);
      }
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
      /* The Undo WINDOW is a delay, not an animation, so it still applies — only
         the decorative countdown bar is suppressed here. */
      .action.complete .undo-progress {
        animation: none;
        display: none;
      }
    }
  `;

  @property({ attribute: false }) task!: Task;
  /** The designated Someday list id (or null); threaded from the controller. */
  @property({ attribute: false }) somedayListId: string | null = null;
  /**
   * How to render the due date. Defaults to `'auto'` (the relative label). The
   * Scheduled view overrides this per bucket: `'hidden'` where the header already
   * states the day, or an absolute date string for the range buckets.
   */
  @property({ attribute: false }) dueDisplay: DueDisplay = 'auto';
  /**
   * True when this row is the keyboard-selected task. Reflected to an attribute
   * so the `:host([selected])` highlight applies; toggled by the list view.
   */
  @property({ type: Boolean, reflect: true }) selected = false;

  @state() private offset = 0;
  @state() private animating = false;
  @state() private completing = false;
  @state() private snoozeOpen = false;
  @state() private snoozeOptions: SnoozeOption[] = [];
  /**
   * True between committing a Complete and it either being undone or the window
   * elapsing. While set, the green bar shows the Undo affordance and the card
   * ignores further gestures.
   */
  @state() private undoPending = false;

  /** Single-shot timer backing the Undo window (state machine in ./undo.ts). */
  private readonly undo = new UndoTimer();

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
    // While a Complete is held behind its Undo window, swallow new gestures on
    // this card so a swipe/tap can't start a second action or re-trigger.
    if (this.snoozeOpen || this.undoPending) return;
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
      // No horizontal swipe was committed and no vertical scroll took over (that
      // path aborts the drag in onPointerMove). If the pointer barely moved,
      // treat this as a plain TAP on the card body and open the edit screen.
      // Taps on the complete circle / snooze button never reach here: those
      // buttons stopPropagation on pointerdown, so this drag was never started.
      const dx = e.clientX - this.startX;
      const dy = e.clientY - this.startY;
      const moved = Math.abs(dx) > TAP_MOVE_SLOP || Math.abs(dy) > TAP_MOVE_SLOP;
      this.offset = 0;
      if (!moved && !this.completing) {
        this.dispatchEvent(
          new CustomEvent('task-open', {
            detail: { task: this.task },
            bubbles: true,
            composed: true,
          }),
        );
      }
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
    this.flyOutAndComplete();
  };

  /**
   * Commit a Complete, but hold it behind a ~2s Undo window instead of
   * collapsing immediately: slide the front out so the green bar is revealed,
   * mark `completing`/`undoPending`, and start the timer. Then either
   * `onUndo` cancels it (spring back, no completion) or the window elapses and
   * `onUndoElapsed` collapses the row and dispatches `task-complete`.
   */
  private flyOutAndComplete(): void {
    if (this.undoPending) return;
    this.completing = true;
    this.undoPending = true;
    this.slideOut('right');
    this.undo.start(() => this.onUndoElapsed());
  }

  /** Undo tapped: cancel the window (if still pending) and spring back to rest. */
  private onUndo = (e: Event) => {
    e.stopPropagation();
    this.cancelUndo();
  };

  /**
   * Cancel a pending Complete (if the Undo window is still open) and spring the
   * row back to rest. Returns true when an undo was actually performed. Shared
   * by the on-screen Undo button and {@link undoFromKeyboard}.
   */
  private cancelUndo(): boolean {
    if (!this.undo.cancel()) return false;
    this.undoPending = false;
    this.completing = false;
    this.animating = true;
    this.offset = 0;
    return true;
  }

  // --- keyboard entry points (desktop shortcuts) ---------------------------

  /** True while a Complete is held behind its Undo window (view queries this). */
  get hasPendingUndo(): boolean {
    return this.undoPending;
  }

  /**
   * Complete this task via the SAME path as the on-screen circle / swipe, so the
   * ~2s in-gap Undo window still applies. No-op if already completing or the
   * snooze menu is open.
   */
  completeFromKeyboard(): void {
    if (this.completing || this.snoozeOpen || this.undoPending) return;
    this.animating = true;
    this.flyOutAndComplete();
  }

  /** Open this card's snooze menu (same menu the left-swipe / button opens). */
  openSnoozeFromKeyboard(): void {
    if (this.snoozeOpen || this.undoPending) return;
    this.openSnooze();
  }

  /** Trigger this card's pending Undo, if any. Returns true when it fired. */
  undoFromKeyboard(): boolean {
    return this.cancelUndo();
  }

  /** The Undo window elapsed: collapse the row, then dispatch the completion. */
  private onUndoElapsed(): void {
    this.undoPending = false;
    this.collapseThenDispatch(() => this.dispatchComplete());
  }

  private dispatchComplete(): void {
    this.dispatchEvent(
      new CustomEvent('task-complete', {
        detail: { task: this.task },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * If the card unmounts (navigation / view change) with a Complete still held
   * behind its Undo window, FLUSH it: stop the timer and dispatch the completion
   * now so a pending completion is never silently lost.
   */
  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.undo.cancel()) {
      this.undoPending = false;
      this.dispatchComplete();
    }
  }

  /** Slide the front fully out in `dir`, revealing the coloured action bar. */
  private slideOut(dir: 'left' | 'right'): void {
    this.animating = true;
    this.offset = (dir === 'right' ? 1 : -1) * this.width() * 1.15;
  }

  /**
   * Collapse the row's height to 0 (snappy, ~150ms) so completing/snoozing
   * doesn't leave an empty gap, and finally fire `dispatch` for the controller
   * to drop the task. Under reduced motion the shadow-DOM rule zeroes the height
   * transition, but the setTimeout below still fires, so the row is removed
   * either way. Assumes the front is already slid out.
   */
  private collapseThenDispatch(dispatch: () => void): void {
    const startHeight = this.offsetHeight;
    // Pin the current height, force a reflow, then transition it to 0.
    this.style.height = `${startHeight}px`;
    this.style.transition = 'height 0.15s ease';
    void this.offsetHeight;
    requestAnimationFrame(() => {
      this.style.height = '0px';
    });
    window.setTimeout(dispatch, 170);
  }

  /**
   * Slide the front out in `dir` then collapse+dispatch. Used by the snooze /
   * someday / no-date paths, which commit immediately (no Undo window).
   */
  private flyOutCollapse(dir: 'left' | 'right', dispatch: () => void): void {
    this.slideOut(dir);
    this.collapseThenDispatch(dispatch);
  }

  /** Explicit snooze button (desktop-friendly): same path as a left-swipe commit. */
  private onSnoozeButton = (e: Event) => {
    e.stopPropagation();
    if (this.snoozeOpen || this.undoPending) return;
    this.openSnooze();
  };

  private openSnooze(): void {
    // Spring the card back to rest, then raise the menu.
    this.offset = 0;
    this.snoozeOptions = computeSnoozeOptions(new Date(), {
      includeToday: !this.isDueToday,
      includeSomeday: this.somedayListId != null && !this.isSomedayTask,
      // Only offer "No date" when there's actually a due date to clear.
      includeNoDate: this.task?.due != null,
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
    // The "No date" option is also dateless, but only CLEARS the due date (it
    // does not move lists). Dispatch its own DISTINCT event (task-nodate),
    // separate from both task-someday and the dated task-snooze.
    if (opt.key === 'nodate') {
      this.flyOutCollapse('left', () => {
        this.dispatchEvent(
          new CustomEvent('task-nodate', {
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
    // Resolve the due text per `dueDisplay`: nothing when there's no date or it's
    // hidden; the relative label for 'auto'; otherwise the exact string given.
    const dueText =
      due == null || this.dueDisplay === 'hidden'
        ? null
        : this.dueDisplay === 'auto'
          ? formatDueLabel(due, new Date())
          : this.dueDisplay;
    return html`
      <div
        class="action complete ${this.undoPending ? 'undo' : ''}"
        aria-hidden=${this.undoPending ? 'false' : 'true'}
        ?hidden=${!revealComplete}
      >
        ${this.undoPending
          ? html`
              <span class="completed-label">Completed</span>
              <button
                class="undo-btn"
                type="button"
                aria-label="Undo complete"
                @pointerdown=${this.stopDrag}
                @click=${this.onUndo}
              >
                Undo
              </button>
              <div class="undo-progress" aria-hidden="true"></div>
            `
          : html`
              <svg viewBox="0 0 24 24">
                <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
              </svg>
              <span>Complete</span>
            `}
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
            ${dueText
              ? html`<span class="due ${overdue ? 'overdue' : ''}">${dueText}</span>`
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
