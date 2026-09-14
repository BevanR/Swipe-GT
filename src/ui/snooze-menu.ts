import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@material/web/dialog/dialog.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
import '@material/web/button/text-button.js';
import type { SnoozeOption } from '../types';
import { formatFullDate } from '../logic/dueLabel';
import type { MdDialog } from '@material/web/dialog/dialog.js';

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
    .pickrow {
      display: flex;
      justify-content: flex-end;
      padding: 8px 16px 4px;
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

  private dialog(): MdDialog | null {
    return this.renderRoot.querySelector('md-dialog');
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has('open')) {
      const d = this.dialog();
      if (!d) return;
      // Reset the pick-a-date affordance each time the menu opens or closes.
      this.picking = false;
      if (this.open && !d.open) void d.show();
      else if (!this.open && d.open) void d.close();
    }
    if (changed.has('picking') && this.picking) {
      void this.updateComplete.then(() =>
        this.renderRoot.querySelector<HTMLInputElement>('input[type="date"]')?.focus(),
      );
    }
  }

  private pick(option: SnoozeOption): void {
    this.dispatchEvent(
      new CustomEvent('snooze-pick', { detail: option, bubbles: true, composed: true }),
    );
  }

  /** Reveal the inline native date input for an arbitrary date. */
  private startPick(): void {
    this.picking = true;
  }

  /** Dispatch a `pick` snooze once the user has chosen a date. */
  private onPickDate(e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    if (!value) return;
    this.pick({ key: 'pick', label: 'Pick a date', date: value });
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
            @click=${() => this.startPick()}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.startPick();
              }
            }}
          >
            <span slot="headline">Pick a date</span>
            <span slot="supporting-text" class="date">Choose any date</span>
          </md-list-item>
        </md-list>
        ${this.picking
          ? html`<div class="pickrow" slot="content">
              <input
                type="date"
                aria-label="Pick a due date"
                @input=${(e: Event) => this.onPickDate(e)}
              />
            </div>`
          : nothing}
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
