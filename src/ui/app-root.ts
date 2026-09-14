import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AppController } from '../app/controller';
import type { AppState } from '../app/state';
import type { Task, ThemeName, ViewName } from '../types';
import './connect-screen.js';
import './task-list-view.js';
import './settings-screen.js';

/**
 * Top-level shell. Subscribes to the controller's state and renders the current
 * screen, and translates the bubbled component events into controller calls.
 */
@customElement('app-root')
export class AppRoot extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .loading {
      display: flex;
      min-height: 100dvh;
      align-items: center;
      justify-content: center;
      color: var(--app-on-surface-muted);
    }
    .toast {
      position: fixed;
      left: 50%;
      bottom: calc(24px + env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%);
      max-width: min(92vw, 480px);
      background: #323232;
      color: #fff;
      padding: 12px 18px;
      border-radius: 8px;
      box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);
      font-size: 0.88rem;
      z-index: 50;
    }
  `;

  @property({ attribute: false }) controller!: AppController;
  @state() private st!: AppState;

  private onChange = () => {
    this.st = this.controller.state;
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.st = this.controller.state;
    this.controller.addEventListener('change', this.onChange);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.controller.removeEventListener('change', this.onChange);
  }

  render() {
    const s = this.st;
    if (!s) return nothing;
    return html`
      <div
        @connect=${() => void this.controller.connect()}
        @refresh=${() => void this.controller.refresh()}
        @open-settings=${() => this.controller.openSettings()}
        @close=${() => this.controller.closeSettings()}
        @set-theme=${(e: CustomEvent<ThemeName>) => void this.controller.setTheme(e.detail)}
        @set-inclusion=${(e: CustomEvent<{ id: string; included: boolean }>) =>
          void this.controller.setInclusion(e.detail.id, e.detail.included)}
        @disconnect=${() => void this.controller.disconnect()}
        @task-complete=${(e: CustomEvent<{ task: Task }>) =>
          void this.controller.completeTask(e.detail.task)}
        @task-snooze=${(e: CustomEvent<{ task: Task; due: string }>) =>
          void this.controller.snoozeTask(e.detail.task, e.detail.due)}
        @set-view=${(e: CustomEvent<ViewName>) => void this.controller.setView(e.detail)}
      >
        ${this.renderScreen(s)}
      </div>
      ${s.toast
        ? html`<div class="toast" role="alert" @click=${() => this.controller.dismissToast()}>
            ${s.toast}
          </div>`
        : nothing}
    `;
  }

  private renderScreen(s: AppState) {
    switch (s.screen) {
      case 'loading':
        return html`<div class="loading">Loading…</div>`;
      case 'connect':
        return html`<connect-screen ?error=${s.connectError}></connect-screen>`;
      case 'settings':
        return html`<settings-screen
          .theme=${s.theme}
          .lists=${s.lists}
        ></settings-screen>`;
      case 'list':
      default:
        return html`<task-list-view
          .grouped=${s.grouped}
          .allTasks=${s.allTasks}
          .view=${s.view}
          ?offline=${s.offline}
          ?fromCache=${s.fromCache}
          ?loading=${s.loading}
          .fetchedAt=${s.fetchedAt}
        ></task-list-view>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-root': AppRoot;
  }
}
