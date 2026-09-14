import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { SnoozeOption, Task } from '../types';
import { computeSnoozeOptions } from '../logic/snooze';
import { decideSwipe, isHorizontalSwipe, isVerticalScroll } from './swipe';
import './snooze-menu.js';

/**
 * A single swipeable task card. Hand-rolled pointer-drag (no gesture lib):
 * drag right past threshold → Complete (optimistic fly-out), drag left past
 * threshold → open the Snooze menu. Dispatches `task-complete` and
 * `task-snooze` (detail: { due }) for the controller to act on.
 */
@customElement('task-card')
export class TaskCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      border-radius: var(--app-card-radius);
      background: var(--app-bg);
      touch-action: pan-y;
    }
    .action {
      position: absolute;
      top: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 20px;
      font-weight: 600;
      font-size: 0.9rem;
      color: #fff;
    }
    .action.complete {
      left: 0;
      right: 0;
      justify-content: flex-start;
      background: var(--app-complete);
      color: var(--app-complete-on);
    }
    .action.snooze {
      left: 0;
      right: 0;
      justify-content: flex-end;
      background: var(--app-snooze);
      color: var(--app-snooze-on);
    }
    .action svg {
      width: 22px;
      height: 22px;
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
      border-radius: var(--app-card-radius);
      box-shadow: var(--app-card-shadow);
      border: 1px solid var(--app-border);
      will-change: transform;
      transform: translateX(0);
      user-select: none;
      -webkit-user-select: none;
    }
    .front.animating {
      transition: transform 0.24s cubic-bezier(0.2, 0, 0, 1);
    }
    .checkbox {
      display: var(--app-checkbox-display, none);
      flex: none;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid var(--app-checkbox-border);
    }
    .body {
      min-width: 0;
      flex: 1;
    }
    .title {
      font-size: 0.95rem;
      line-height: 1.35;
      word-break: break-word;
    }
    .meta {
      margin-top: 2px;
      font-size: 0.75rem;
      color: var(--app-on-surface-muted);
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .notes {
      margin-top: 4px;
      font-size: 0.8rem;
      color: var(--app-on-surface-muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  `;

  @property({ attribute: false }) task!: Task;

  @state() private offset = 0;
  @state() private animating = false;
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

  private flyOutAndComplete(): void {
    const w = this.width();
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
    this.snoozeOptions = computeSnoozeOptions(new Date());
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
        class="front ${this.animating ? 'animating' : ''}"
        style="transform: translateX(${this.offset}px)"
        role="group"
        aria-label=${`Task: ${this.task?.title ?? ''}. Swipe right to complete, left to snooze.`}
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerUp}
        @pointercancel=${this.onPointerCancel}
      >
        <span class="checkbox" aria-hidden="true"></span>
        <div class="body">
          <div class="title">${this.task?.title || '(untitled)'}</div>
          <div class="meta">
            <span>${this.task?.taskListTitle}</span>
            ${this.task?.due ? html`<span>· ${this.task.due}</span>` : ''}
          </div>
          ${this.task?.notes ? html`<div class="notes">${this.task.notes}</div>` : ''}
        </div>
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
