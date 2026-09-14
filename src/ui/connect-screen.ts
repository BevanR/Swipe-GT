import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@material/web/button/filled-button.js';

/**
 * The unauthenticated landing screen. A single call-to-action that asks the
 * controller to run the interactive Google sign-in.
 */
@customElement('connect-screen')
export class ConnectScreen extends LitElement {
  static styles = css`
    :host {
      display: flex;
      min-height: 100dvh;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
    }
    .card {
      width: 100%;
      max-width: 360px;
      text-align: center;
      background: var(--app-surface);
      color: var(--app-on-surface);
      border: 1px solid var(--app-border);
      border-radius: 16px;
      box-shadow: var(--app-card-shadow);
      padding: 32px 24px;
    }
    .mark {
      width: 56px;
      height: 56px;
      margin: 0 auto 16px;
      border-radius: 16px;
      background: var(--app-accent);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .mark svg {
      width: 32px;
      height: 32px;
      fill: #fff;
    }
    h1 {
      font-size: 1.25rem;
      margin: 0 0 6px;
    }
    p {
      color: var(--app-on-surface-muted);
      font-size: 0.9rem;
      margin: 0 0 24px;
      line-height: 1.5;
    }
    .error {
      color: var(--app-danger);
      font-size: 0.85rem;
      margin-top: 16px;
    }
    md-filled-button {
      width: 100%;
    }
  `;

  @property({ type: Boolean }) error = false;
  @property({ type: Boolean }) busy = false;

  private connect(): void {
    this.dispatchEvent(new CustomEvent('connect', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <div class="card">
        <div class="mark" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>
        </div>
        <h1>Swipe GT</h1>
        <p>
          Swipe through the tasks you have due today or overdue. Swipe right to complete, left to
          snooze.
        </p>
        <md-filled-button ?disabled=${this.busy} @click=${() => this.connect()}>
          ${this.busy ? 'Connecting…' : 'Connect Google Tasks'}
        </md-filled-button>
        ${this.error
          ? html`<div class="error">Couldn't connect. Please try again.</div>`
          : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'connect-screen': ConnectScreen;
  }
}
