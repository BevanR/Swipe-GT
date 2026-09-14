import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AppController } from '../app/controller';
import type { AppState } from '../app/state';
import type { Task, ThemeName, ViewName } from '../types';
import { currentRoute, navigate } from '../app/router.js';
import type { Route } from '../app/router.js';
import type { TaskUpdateChanges } from '../app/controller';
import './connect-screen.js';
import './task-list-view.js';
import './settings-screen.js';
import './add-task-screen.js';
import './edit-task-screen.js';

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
  /** The current hash route; kept in sync with `location.hash`. */
  @state() private route: Route = currentRoute();

  private onChange = () => {
    this.st = this.controller.state;
  };

  private onHashChange = () => {
    this.route = currentRoute();
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.st = this.controller.state;
    this.route = currentRoute();
    this.controller.addEventListener('change', this.onChange);
    window.addEventListener('hashchange', this.onHashChange);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.controller.removeEventListener('change', this.onChange);
    window.removeEventListener('hashchange', this.onHashChange);
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
        @set-someday=${(e: CustomEvent<string | null>) =>
          void this.controller.setSomedayList(e.detail)}
        @disconnect=${() => void this.controller.disconnect()}
        @task-complete=${(e: CustomEvent<{ task: Task }>) =>
          void this.controller.completeTask(e.detail.task)}
        @task-snooze=${(e: CustomEvent<{ task: Task; due: string }>) =>
          void this.controller.snoozeTask(e.detail.task, e.detail.due)}
        @task-someday=${(e: CustomEvent<{ task: Task }>) =>
          void this.controller.moveToSomeday(e.detail.task)}
        @task-open=${(e: CustomEvent<{ task: Task }>) =>
          navigate('edit', { listId: e.detail.task.taskListId, taskId: e.detail.task.id })}
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
          .somedayListId=${s.somedayListId}
        ></settings-screen>`;
      case 'list':
      default:
        // Auth is settled and we're on the main app; the hash route decides
        // whether to show the Add Task screen or the list. New route branches
        // (e.g. a future `#/edit/...`) slot in here.
        if (this.route.name === 'add') {
          return html`<add-task-screen
            .lists=${s.lists}
            .onSubmit=${(input: { taskListId: string; title: string; due?: string }) =>
              this.controller.addTask(input)}
          ></add-task-screen>`;
        }
        if (this.route.name === 'edit') {
          const { listId, taskId } = this.route.params;
          const task = s.allTasks.find((t) => t.taskListId === listId && t.id === taskId);
          if (task) {
            return html`<edit-task-screen
              .task=${task}
              .lists=${s.lists}
              .onSave=${(changes: TaskUpdateChanges) =>
                this.controller.updateTask(task, changes)}
              .onDelete=${() => this.controller.deleteTask(task)}
            ></edit-task-screen>`;
          }
          // Stale/deep-linked hash to a task we don't hold (e.g. it was completed
          // elsewhere): drop back to the list rather than render an empty editor.
          navigate('list');
        }
        return html`<task-list-view
          .grouped=${s.grouped}
          .scheduled=${s.scheduled}
          .someday=${s.someday}
          .allTasks=${s.allTasks}
          .view=${s.view}
          .somedayListId=${s.somedayListId}
          ?offline=${s.offline}
          ?fromCache=${s.fromCache}
          ?loading=${s.loading}
          .fetchedAt=${s.fetchedAt}
          .lists=${s.lists}
        ></task-list-view>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-root': AppRoot;
  }
}
