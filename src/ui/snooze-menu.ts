import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
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
  `;

  @property({ type: Array }) options: SnoozeOption[] = [];
  @property({ type: Boolean }) open = false;

  private dialog(): MdDialog | null {
    return this.renderRoot.querySelector('md-dialog');
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has('open')) {
      const d = this.dialog();
      if (!d) return;
      if (this.open && !d.open) void d.show();
      else if (!this.open && d.open) void d.close();
    }
  }

  private pick(option: SnoozeOption): void {
    this.dispatchEvent(
      new CustomEvent('snooze-pick', { detail: option, bubbles: true, composed: true }),
    );
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
                aria-label=${`Snooze until ${opt.label}, ${formatFullDate(opt.date)}`}
                @click=${() => this.pick(opt)}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.pick(opt);
                  }
                }}
              >
                <span slot="headline">${opt.label}</span>
                <span slot="supporting-text" class="date">${formatFullDate(opt.date)}</span>
              </md-list-item>
            `,
          )}
        </md-list>
        <div slot="actions">
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
