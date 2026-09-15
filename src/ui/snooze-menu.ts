import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import '@material/web/dialog/dialog.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
import '@material/web/button/text-button.js';
import type { SnoozeOption } from '../types';
import { formatFullDate } from '../logic/dueLabel';
import { normalizePickedDate } from '../logic/dueOptions';
import type { MdDialog } from '@material/web/dialog/dialog.js';
import type { DialogAnimation } from '@material/web/dialog/internal/animations.js';

/**
 * A Material dialog that lists snooze options. Presentational: it renders the
 * options it is given and dispatches `snooze-pick` (detail: SnoozeOption) or
 * `snooze-cancel`. The parent decides what the options are (from
 * computeSnoozeOptions) and what to do with the choice.
 */
@customElement('snooze-menu')
export class SnoozeMenu extends LitElement {
  static styles = css`
    md-dialog {
      --md-dialog-container-color: var(--app-surface);
    }
    /* Mobile: present the menu as a bottom sheet so EVERY option (up to ~9 plus
       "Pick a date" and Cancel) is reachable without an inner scroll. Material's
       dialog sets max-width/height/margin/border-radius to \`inherit\` on the
       inner native <dialog>, so overriding those on the host flows through to it:
       margin \`auto 0 0\` pins the modal to the bottom, full width, with only the
       top corners rounded. \`!important\` beats Material's own :host rules (which
       have higher base specificity than this type selector). */
    @media (max-width: 600px) {
      md-dialog {
        margin: auto 0 0 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        max-height: 92dvh !important;
        border-start-start-radius: 16px !important;
        border-start-end-radius: 16px !important;
        border-end-start-radius: 0 !important;
        border-end-end-radius: 0 !important;
      }
      /* Compact the rows so the full set fits the sheet without scrolling. */
      md-list-item {
        --md-list-item-two-line-container-height: 56px;
      }
      /* Clear the phone's bottom safe-area inset under the Cancel action. */
      .actions {
        padding-bottom: env(safe-area-inset-bottom, 0px);
      }
    }
    .title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--app-on-surface);
    }
    md-list {
      --md-list-container-color: var(--app-surface);
    }
    md-list-item {
      cursor: pointer;
      color: var(--app-on-surface);
    }
    .date {
      color: var(--app-on-surface-muted);
      font-size: 0.8rem;
    }
    /* The pick-a-date row is collapsed by default — the input is always in the
       DOM (so showPicker() has a target inside the tap gesture) but hidden until
       we need the visible fallback. */
    .pickrow {
      display: flex;
      justify-content: flex-end;
      padding: 0;
      height: 0;
      overflow: hidden;
    }
    .pickrow.show {
      padding: 8px 16px 4px;
      height: auto;
      overflow: visible;
    }
    /* Hidden-but-rendered date input (present so showPicker() works); revealed
       as a normal field only when .show (the no-showPicker fallback). */
    input.pickdate {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
      padding: 0;
      border: 0;
      pointer-events: none;
    }
    input.pickdate.show {
      position: static;
      opacity: 1;
      width: auto;
      height: auto;
      pointer-events: auto;
    }
    input[type='date'] {
      appearance: none;
      font: inherit;
      font-size: 0.95rem;
      color: var(--app-on-surface);
      background: var(--app-surface);
      border: 1px solid var(--app-border);
      border-radius: 8px;
      padding: 10px 12px;
      color-scheme: light dark;
    }
    input[type='date']:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: -1px;
    }
  `;

  @property({ type: Array }) options: SnoozeOption[] = [];
  @property({ type: Boolean }) open = false;

  /** Whether the inline "Pick a date" input is revealed. */
  @state() private picking = false;

  /**
   * Guards the date input against a single OS-picker selection firing BOTH
   * `change` and `input` (or firing twice) and dispatching two `snooze-pick`s.
   * Reset each time the "Pick a date" affordance is revealed.
   */
  private pickHandled = false;

  /** The always-rendered (hidden) native date input backing "Pick a date". */
  @query('input.pickdate') private dateInput?: HTMLInputElement;

  private dialog(): MdDialog | null {
    return this.renderRoot.querySelector('md-dialog');
  }

  /**
   * Override Material's default open/close animations (which slide the dialog
   * from the TOP and are slow) so the snooze sheet slides UP from the bottom to
   * open and DOWN to close, quickly. md-dialog lets us swap these via the
   * `getOpenAnimation()` / `getCloseAnimation()` instance methods; each returns a
   * {@link DialogAnimation} of Web Animations `[keyframes, options]` tuples per
   * dialog part. We compute per-invocation so the correct variant is chosen for
   * the CURRENT viewport (mobile bottom-sheet vs desktop centered dialog) and for
   * `prefers-reduced-motion` at the moment the dialog opens/closes.
   */
  firstUpdated(): void {
    const d = this.dialog();
    if (!d) return;
    d.getOpenAnimation = () => this.dialogAnimation('open');
    d.getCloseAnimation = () => this.dialogAnimation('close');
  }

  private prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  private isMobile(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 600px)').matches
    );
  }

  /**
   * Build the open/close animation for the current context. Reduced motion ⇒ no
   * transform animation (the dialog just appears/disappears). Mobile ⇒ the sheet
   * translates up from / down to the bottom (fast: ~180ms open, ~150ms close).
   * Desktop (>600px) ⇒ a quick centered fade+scale. The scrim fades to/from its
   * resting 32% opacity (matching Material's CSS so it doesn't pop at the end).
   */
  private dialogAnimation(phase: 'open' | 'close'): DialogAnimation {
    if (this.prefersReducedMotion()) return {};

    if (this.isMobile()) {
      if (phase === 'open') {
        return {
          container: [
            [
              [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }],
              { duration: 180, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' },
            ],
          ],
          scrim: [[[{ opacity: 0 }, { opacity: 0.32 }], { duration: 180, easing: 'linear' }]],
        };
      }
      return {
        container: [
          [
            [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }],
            { duration: 150, easing: 'cubic-bezier(0.3, 0, 0.8, 0.15)' },
          ],
        ],
        scrim: [[[{ opacity: 0.32 }, { opacity: 0 }], { duration: 150, easing: 'linear' }]],
      };
    }

    // Desktop: quick centered fade + subtle scale.
    if (phase === 'open') {
      return {
        container: [
          [
            [
              { opacity: 0, transform: 'scale(0.95)' },
              { opacity: 1, transform: 'scale(1)' },
            ],
            { duration: 150, easing: 'ease-out' },
          ],
        ],
        scrim: [[[{ opacity: 0 }, { opacity: 0.32 }], { duration: 150, easing: 'linear' }]],
      };
    }
    return {
      container: [
        [
          [
            { opacity: 1, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(0.95)' },
          ],
          { duration: 120, easing: 'ease-in' },
        ],
      ],
      scrim: [[[{ opacity: 0.32 }, { opacity: 0 }], { duration: 120, easing: 'linear' }]],
    };
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has('open')) {
      const d = this.dialog();
      if (!d) return;
      // Reset the pick-a-date affordance each time the menu opens or closes.
      this.picking = false;
      this.pickHandled = false;
      if (this.open && !d.open) {
        // Start each open from a clean returnValue so a prior "picked" close
        // can't make the next scrim/Escape dismissal skip the cancel path.
        d.returnValue = '';
        void d.show();
      } else if (!this.open && d.open) {
        void d.close();
      }
    }
  }

  private pick(option: SnoozeOption): void {
    // Mark this close as a deliberate pick so the dialog's @closed handler does
    // NOT treat the ensuing close (driven by the parent flipping `open`) as a
    // cancel. Material's md-dialog exposes the native <dialog> returnValue.
    const d = this.dialog();
    if (d) d.returnValue = 'picked';
    this.dispatchEvent(
      new CustomEvent('snooze-pick', { detail: option, bubbles: true, composed: true }),
    );
  }

  /**
   * Open the OS date picker for "Pick a date". Called SYNCHRONOUSLY from the tap
   * handler so it runs inside the user-activation window — the previous approach
   * called showPicker() in a later `updated()` microtask, which Android rejects
   * (no activation), so it fell back to focus() and the picker never opened. The
   * date input is always in the DOM (hidden), so showPicker() has a target now.
   * If showPicker() is unsupported/throws, reveal the input as a visible fallback.
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
      // Older browsers / no support: reveal the field and focus it so the user
      // can still open it with a direct tap.
      this.picking = true;
      void this.updateComplete.then(() => this.dateInput?.focus());
    }
  }

  /**
   * Apply a date chosen from the native `<input type="date">`. Bound to BOTH
   * `change` and `input`: Android browsers fire `change` (not always `input`)
   * when a date is committed from the OS calendar, especially via showPicker(),
   * so listening only for `input` left the selection unapplied until a second
   * tap. `pickHandled` dedupes the two events from a single selection.
   */
  private onPickDate(e: Event): void {
    if (this.pickHandled) return;
    const date = normalizePickedDate((e.target as HTMLInputElement).value);
    if (!date) return;
    this.pickHandled = true;
    this.pick({ key: 'pick', label: 'Pick a date', date });
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('snooze-cancel', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <md-dialog
        aria-label="Snooze until"
        @closed=${(e: Event) => {
          // Only treat as cancel when a dialog close wasn't driven by a pick.
          const d = e.target as MdDialog;
          if (d.returnValue !== 'picked') this.cancel();
        }}
      >
        <div slot="headline" class="title">Snooze until…</div>
        <md-list slot="content" role="menu">
          ${this.options.map(
            (opt) => html`
              <md-list-item
                type="button"
                role="menuitem"
                aria-label=${opt.date == null
                  ? `Snooze: ${opt.label}, no date`
                  : `Snooze until ${opt.label}, ${formatFullDate(opt.date)}`}
                @click=${() => this.pick(opt)}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.pick(opt);
                  }
                }}
              >
                <span slot="headline">${opt.label}</span>
                <span slot="supporting-text" class="date"
                  >${opt.date == null ? 'No date' : formatFullDate(opt.date)}</span
                >
              </md-list-item>
            `,
          )}
          <md-list-item
            type="button"
            role="menuitem"
            aria-label="Pick a date"
            @click=${() => this.onPickClick()}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.onPickClick();
              }
            }}
          >
            <span slot="headline">Pick a date</span>
            <span slot="supporting-text" class="date">Choose any date</span>
          </md-list-item>
        </md-list>
        <div class="pickrow ${this.picking ? 'show' : ''}" slot="content">
          <input
            class="pickdate ${this.picking ? 'show' : ''}"
            type="date"
            aria-label="Pick a due date"
            @change=${(e: Event) => this.onPickDate(e)}
            @input=${(e: Event) => this.onPickDate(e)}
          />
        </div>
        <div slot="actions" class="actions">
          <md-text-button @click=${() => this.cancel()}>Cancel</md-text-button>
        </div>
      </md-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'snooze-menu': SnoozeMenu;
  }
}
