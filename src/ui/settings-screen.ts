import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@material/web/checkbox/checkbox.js';
import '@material/web/button/outlined-button.js';
import type { MdCheckbox } from '@material/web/checkbox/checkbox.js';
import type { TaskList, ThemeName } from '../types';

/**
 * Settings: theme toggle, per-list inclusion, and disconnect. Presentational —
 * dispatches `set-theme`, `set-inclusion`, `disconnect`, and `close`.
 */
@customElement('settings-screen')
export class SettingsScreen extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .wrap {
      max-width: var(--app-max-width);
      margin: 0 auto;
      min-height: 100dvh;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: max(12px, env(safe-area-inset-top, 0px)) 12px 12px;
      background: var(--app-header-bg);
      border-bottom: 1px solid var(--app-border);
      position: sticky;
      top: 0;
    }
    header h1 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .iconbtn {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--app-on-surface);
      width: 40px;
      height: 40px;
      border-radius: 50%;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .iconbtn svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
    }
    section {
      padding: 20px 16px;
      border-bottom: 1px solid var(--app-border);
    }
    h2 {
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--app-on-surface-muted);
      margin: 0 0 12px;
    }
    .seg {
      display: inline-flex;
      border: 1px solid var(--app-border);
      border-radius: 999px;
      overflow: hidden;
    }
    .seg button {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--app-on-surface);
      padding: 8px 20px;
      font-size: 0.9rem;
      cursor: pointer;
    }
    .seg button[aria-pressed='true'] {
      background: var(--app-accent);
      color: #fff;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0;
    }
    .row label {
      flex: 1;
      cursor: pointer;
    }
    .note {
      color: var(--app-on-surface-muted);
      font-size: 0.8rem;
      margin: 4px 0 0;
      line-height: 1.4;
    }
    .empty-lists {
      color: var(--app-on-surface-muted);
      font-size: 0.85rem;
    }
    md-outlined-button {
      --md-sys-color-primary: var(--app-danger);
    }
  `;

  @property() accessor theme: ThemeName = 'inbox';
  @property({ attribute: false }) accessor lists: TaskList[] = [];

  private setTheme(theme: ThemeName): void {
    this.dispatchEvent(
      new CustomEvent('set-theme', { detail: theme, bubbles: true, composed: true }),
    );
  }

  private toggleInclusion(list: TaskList, e: Event): void {
    const cb = e.target as MdCheckbox;
    this.dispatchEvent(
      new CustomEvent('set-inclusion', {
        detail: { id: list.id, included: cb.checked },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div class="wrap">
        <header>
          <button
            class="iconbtn"
            aria-label="Back"
            @click=${() =>
              this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}
          >
            <svg viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" /></svg>
          </button>
          <h1>Settings</h1>
        </header>

        <section>
          <h2>Theme</h2>
          <div class="seg" role="group" aria-label="Theme">
            <button
              aria-pressed=${this.theme === 'inbox'}
              @click=${() => this.setTheme('inbox')}
            >
              Inbox
            </button>
            <button
              aria-pressed=${this.theme === 'tasks'}
              @click=${() => this.setTheme('tasks')}
            >
              Tasks
            </button>
          </div>
        </section>

        <section>
          <h2>Lists</h2>
          ${this.lists.length === 0
            ? html`<div class="empty-lists">No task lists loaded yet.</div>`
            : this.lists.map(
                (list) => html`
                  <div class="row">
                    <label id=${`lbl-${list.id}`}>${list.title}</label>
                    <md-checkbox
                      aria-labelledby=${`lbl-${list.id}`}
                      ?checked=${list.included}
                      @change=${(e: Event) => this.toggleInclusion(list, e)}
                    ></md-checkbox>
                  </div>
                `,
              )}
          <p class="note">Unchecked lists are hidden from the swipe view.</p>
        </section>

        <section>
          <h2>Account</h2>
          <md-outlined-button
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent('disconnect', { bubbles: true, composed: true }),
              )}
          >
            Disconnect
          </md-outlined-button>
          <p class="note">
            Google may ask you to re-grant access periodically; just tap Connect again if that
            happens.
          </p>
        </section>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'settings-screen': SettingsScreen;
  }
}
