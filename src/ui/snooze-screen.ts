import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { SnoozeOption, Task } from '../types';
import { computeSnoozeOptions } from '../logic/snooze';
import { normalizePickedDate } from '../logic/dueOptions';
import { back, navigate } from '../app/router';

/**
 * The full-viewport "Postpone" screen for a single task, mounted for the
 * `#/snooze/<listId>/<taskId>` route. It replaces the old bottom-sheet
 * `<snooze-menu>` dialog. Being a real route (not a dialog over the list) fixes
 * three long-standing problems at once:
 *  - it is full-viewport, so it is never cramped on desktop;
 *  - there is no scrim that failed to cover the header (there is no scrim);
 *  - up/down arrows move ONLY within the options — there is no background task
 *    list underneath to also receive them; and
 *  - the app-root global list keydown handler is gated to the `list` route, so it
 *    is OFF here. That is what fixes the reported bug where pressing Enter on a
 *    postpone option ALSO fired the list's `Enter → edit` shortcut and threw the
 *    user onto the edit screen.
 *
 * It mirrors edit-task-screen's layout (sticky header with a back/cancel arrow +
 * title, capped-width full-height body). Picking an option dispatches the SAME
 * bubbling events the card used (`task-snooze` / `task-now` / `task-someday`),
 * which app-root already wires to the controller, then returns to the list.
 */
@customElement('snooze-screen')
export class SnoozeScreen extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 30;
      background: var(--app-bg);
      color: var(--app-on-surface);
      animation: screen-in 0.15s cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
    @keyframes screen-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    .wrap {
      max-width: var(--app-max-width);
      margin: 0 auto;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 8px;
      padding-top: max(12px, env(safe-area-inset-top, 0px));
      padding-right: max(8px, env(safe-area-inset-right, 0px));
      padding-left: max(8px, env(safe-area-inset-left, 0px));
      border-bottom: 1px solid var(--app-border);
      background: var(--app-header-bg);
    }
    header h1 {
      flex: 1;
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .iconbtn {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--app-on-surface-muted);
      width: 40px;
      height: 40px;
      border-radius: 50%;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .iconbtn:hover {
      background: color-mix(in srgb, var(--app-on-surface) 8%, transparent);
    }
    .iconbtn:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: -2px;
    }
    .iconbtn svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
    }
    .subtitle {
      padding: 12px 20px 4px;
      font-size: 0.8rem;
      color: var(--app-on-surface-muted);
    }
    .subtitle .task {
      color: var(--app-on-surface);
      font-weight: 600;
    }
    /* The options list fills the remaining height; each row is a big tappable
       target (no cramped bottom sheet). */
    .options {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      list-style: none;
      margin: 0;
      padding: 8px 0 max(16px, env(safe-area-inset-bottom, 0px));
      outline: none;
    }
    .opt {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      box-sizing: border-box;
      padding: 18px 20px;
      padding-left: max(20px, env(safe-area-inset-left, 0px));
      padding-right: max(20px, env(safe-area-inset-right, 0px));
      cursor: pointer;
      color: var(--app-on-surface);
      border: none;
      background: transparent;
      font: inherit;
      text-align: left;
    }
    .opt:hover {
      background: color-mix(in srgb, var(--app-on-surface) 6%, transparent);
    }
    .opt[aria-selected='true'] {
      background: color-mix(in srgb, var(--app-accent) 12%, transparent);
      box-shadow: inset 3px 0 0 var(--app-accent);
    }
    .opt .label {
      flex: 1;
      font-size: 1rem;
      font-weight: 500;
    }
    .opt svg {
      width: 22px;
      height: 22px;
      fill: var(--app-on-surface-muted);
      flex: none;
    }
    /* The date input is ALWAYS rendered (so showPicker() has a target inside the
       tap gesture) but hidden until "Pick a date" is chosen — then .show reveals
       it as a normal, tappable field (the no-showPicker fallback). */
    input.pickdate {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
      margin: 0;
      padding: 0;
      border: 0;
      pointer-events: none;
    }
    input.pickdate.show {
      position: static;
      opacity: 1;
      width: calc(100% - 40px);
      height: auto;
      margin: 4px 20px 16px;
      padding: 12px;
      border: 1px solid var(--app-border);
      border-radius: 8px;
      pointer-events: auto;
      appearance: none;
      font: inherit;
      font-size: 0.95rem;
      color: var(--app-on-surface);
      background: var(--app-surface);
      color-scheme: light dark;
      box-sizing: border-box;
    }
    input.pickdate.show:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: -1px;
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        animation: none;
      }
    }
  `;

  /** The task being postponed. */
  @property({ attribute: false }) task!: Task;
  /** The designated Someday list id, or null when none is configured. */
  @property({ attribute: false }) somedayListId: string | null = null;

  /** The keyboard-highlighted option index. */
  @state() private selectedIndex = 0;
  /** Whether the inline "Pick a date" fallback input is revealed. */
  @state() private picking = false;

  /** Guards a single OS-picker selection firing both `change` and `input`. */
  private pickHandled = false;

  /** The always-rendered (hidden) native date input backing "Pick a date". */
  @query('input.pickdate') private dateInput?: HTMLInputElement;
  /** The options listbox, focused on mount for a11y. */
  @query('.options') private listbox?: HTMLElement;

  /**
   * True only when the task has a due date that equals today (local calendar).
   * Mirrors the include-logic the card used to compute in `openSnooze`.
   */
  private get isDueToday(): boolean {
    const due = this.task?.due;
    if (!due) return false;
    return due.slice(0, 10) === this.todayStr();
  }

  /** True when the task is already a dateless task in the Someday list. */
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

  /**
   * The postpone options for this task — the same set the card's `openSnooze`
   * built, plus a trailing synthetic "Pick a date" entry rendered uniformly.
   */
  private options(): SnoozeOption[] {
    const opts = computeSnoozeOptions(new Date(), {
      includeToday: !this.isDueToday,
      includeSomeday: this.somedayListId != null && !this.isSomedayTask,
      // Offer "Now" unless the task is ALREADY a dateless task in Now — i.e. show
      // it when the task has a due date to clear OR it's parked in Someday.
      includeNow: this.task?.due != null || this.task?.taskListId === this.somedayListId,
    });
    return [...opts, { key: 'pick', label: 'Pick a date', date: null }];
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.selectedIndex = 0;
    this.picking = false;
    this.pickHandled = false;
    // Handle keyboard at the window level so the arrows/Enter/Escape work
    // regardless of which element inside the screen holds focus. app-root's own
    // global list handler is gated off on this route, so there is no conflict.
    window.addEventListener('keydown', this.onKeydown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.onKeydown);
  }

  firstUpdated(): void {
    // Focus the listbox so assistive tech announces the options; keyboard input
    // is handled at the window level regardless.
    this.listbox?.focus();
  }

  private onKeydown = (e: KeyboardEvent) => {
    // Leave the native date input to itself while the fallback picker is open.
    if (e.target instanceof HTMLInputElement) return;
    const opts = this.options();
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        e.preventDefault();
        this.selectedIndex = Math.min(opts.length - 1, this.selectedIndex + 1);
        break;
      case 'ArrowUp':
      case 'k':
        e.preventDefault();
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.activate(opts[this.selectedIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        back();
        break;
    }
  };

  /** Activate an option: either open the date picker, or apply + return. */
  private activate(opt: SnoozeOption): void {
    if (!opt) return;
    if (opt.key === 'pick') {
      this.onPickClick();
      return;
    }
    this.apply(opt);
  }

  /**
   * Apply a chosen (non-"pick") option: dispatch the matching bubbling event
   * (which app-root wires to the controller), then return to the list. The
   * controller's actions are optimistic and surface their own toasts, exactly
   * as when these events came from a swiped card.
   */
  private apply(opt: SnoozeOption): void {
    if (opt.key === 'someday') {
      this.dispatch('task-someday', { task: this.task });
    } else if (opt.key === 'now') {
      this.dispatch('task-now', { task: this.task });
    } else {
      // Every remaining option (today/tomorrow/…/pick) carries a concrete date.
      const due = opt.date as string;
      this.dispatch('task-snooze', { task: this.task, due });
    }
    navigate('list');
  }

  private dispatch(type: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /**
   * Open the OS date picker for "Pick a date". Called SYNCHRONOUSLY from the tap
   * handler (and from Enter on the option) so it runs inside the user-activation
   * window — the date input is always in the DOM. If showPicker() is
   * unsupported/throws, reveal the input as a visible fallback.
   */
  private onPickClick(): void {
    this.pickHandled = false;
    const inp = this.dateInput;
    if (!inp) {
      this.picking = true;
      return;
    }
    try {
      inp.showPicker();
    } catch {
      this.picking = true;
      void this.updateComplete.then(() => this.dateInput?.focus());
    }
  }

  /**
   * Apply a date chosen from the native `<input type="date">`. Bound to BOTH
   * `change` and `input` (Android fires `change`, not always `input`, when a date
   * is committed from the OS calendar). `pickHandled` dedupes the two events.
   */
  private onPickDate(e: Event): void {
    if (this.pickHandled) return;
    const date = normalizePickedDate((e.target as HTMLInputElement).value);
    if (!date) return;
    this.pickHandled = true;
    this.apply({ key: 'pick', label: 'Pick a date', date });
  }

  private cancel(): void {
    back();
  }

  render() {
    const opts = this.options();
    return html`
      <div class="wrap">
        <header>
          <button
            class="iconbtn"
            aria-label="Back"
            title="Cancel (Esc)"
            @click=${() => this.cancel()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" />
            </svg>
          </button>
          <h1>Postpone</h1>
        </header>

        <div class="subtitle">
          Postpone <span class="task">${this.task?.title || '(untitled)'}</span> until…
        </div>

        <ul
          class="options"
          role="listbox"
          tabindex="0"
          aria-label="Postpone until"
          aria-activedescendant=${`snooze-opt-${this.selectedIndex}`}
        >
          ${opts.map(
            (opt, i) => html`
              <li
                id=${`snooze-opt-${i}`}
                class="opt"
                role="option"
                aria-selected=${i === this.selectedIndex}
                @click=${() => {
                  this.selectedIndex = i;
                  this.activate(opt);
                }}
                @pointerenter=${() => (this.selectedIndex = i)}
              >
                <span class="label">${opt.label}</span>
              </li>
            `,
          )}
        </ul>

        <input
          class="pickdate ${this.picking ? 'show' : ''}"
          type="date"
          aria-label="Pick a due date"
          @change=${(e: Event) => this.onPickDate(e)}
          @input=${(e: Event) => this.onPickDate(e)}
        />
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'snooze-screen': SnoozeScreen;
  }
}
