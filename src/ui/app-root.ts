import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AppController } from '../app/controller';
import type { AppState } from '../app/state';
import type { Task, ThemeName, ViewName } from '../types';
import { currentRoute, navigate } from '../app/router.js';
import type { Route } from '../app/router.js';
import type { TaskUpdateChanges } from '../app/controller';
import { keyToAction, isTypingElement } from '../logic/keymap.js';
import './connect-screen.js';
import './task-list-view.js';
import './settings-screen.js';
import './add-task-screen.js';
import './edit-task-screen.js';
import './snooze-screen.js';

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
    /* Keyboard-shortcuts help overlay. A plain modal panel over a scrim; opened
       with "?", closed with Escape, the scrim, or its close button. */
    .help-scrim {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      z-index: 60;
    }
    .help-panel {
      background: var(--app-surface);
      color: var(--app-on-surface);
      border: 1px solid var(--app-border);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      width: min(92vw, 420px);
      max-height: 80dvh;
      overflow: auto;
      padding: 20px 22px;
    }
    .help-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 12px;
    }
    .help-head h2 {
      flex: 1;
      margin: 0;
      font-size: 1.05rem;
      font-weight: 600;
    }
    .help-close {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--app-on-surface-muted);
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 1.2rem;
      line-height: 1;
    }
    .help-close:hover {
      background: color-mix(in srgb, var(--app-on-surface) 8%, transparent);
    }
    .help-close:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: 2px;
    }
    .help-list {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 8px 16px;
      margin: 0;
      align-items: baseline;
    }
    .help-list dt {
      margin: 0;
      text-align: right;
      white-space: nowrap;
    }
    .help-list dd {
      margin: 0;
      color: var(--app-on-surface);
      font-size: 0.9rem;
    }
    .help-list kbd {
      display: inline-block;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
      line-height: 1.4;
      padding: 1px 7px;
      border: 1px solid var(--app-border);
      border-bottom-width: 2px;
      border-radius: 5px;
      background: color-mix(in srgb, var(--app-on-surface) 6%, var(--app-surface));
      color: var(--app-on-surface);
    }
  `;

  @property({ attribute: false }) controller!: AppController;
  @state() private st!: AppState;
  /** The current hash route; kept in sync with `location.hash`. */
  @state() private route: Route = currentRoute();
  /** Whether the keyboard-shortcuts help overlay is showing. */
  @state() private helpOpen = false;

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
    window.addEventListener('keydown', this.onKeydown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.controller.removeEventListener('change', this.onChange);
    window.removeEventListener('hashchange', this.onHashChange);
    window.removeEventListener('keydown', this.onKeydown);
  }

  /** The mounted list view (only present on the main list screen). */
  private listView() {
    return this.renderRoot.querySelector('task-list-view');
  }

  /** True when the keydown originated in a text-entry control (see through shadow DOM). */
  private isTypingContext(e: KeyboardEvent): boolean {
    for (const t of e.composedPath()) {
      if (t instanceof HTMLElement && isTypingElement(t)) return true;
    }
    return false;
  }

  /**
   * Global keyboard shortcuts (desktop enhancement). They run ONLY on the main
   * list screen; every other screen (add/edit/settings/connect, or an open
   * dialog) keeps its own keyboard behaviour untouched. While the user is typing
   * only Escape is honoured, so shortcuts never interfere with the search box or
   * any form field.
   */
  private onKeydown = (e: KeyboardEvent) => {
    const s = this.st;
    if (!s) return;
    const onMainList = s.screen === 'list' && this.route.name === 'list';
    if (!onMainList) return;

    const action = keyToAction(e.key, {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    });
    if (!action) return;

    // While the help overlay is open, swallow everything but its close keys.
    if (this.helpOpen) {
      if (action === 'escape' || action === 'help') {
        e.preventDefault();
        this.helpOpen = false;
      }
      return;
    }

    // Ignore shortcuts while typing, except Escape.
    if (action !== 'escape' && this.isTypingContext(e)) return;

    const view = this.listView();
    switch (action) {
      case 'add':
        e.preventDefault();
        navigate('add');
        break;
      case 'search':
        e.preventDefault();
        view?.openSearchFromKeyboard();
        break;
      case 'view-now':
        e.preventDefault();
        void this.controller.setView('now');
        break;
      case 'view-scheduled':
        e.preventDefault();
        void this.controller.setView('scheduled');
        break;
      case 'view-someday':
        e.preventDefault();
        void this.controller.setView('someday');
        break;
      case 'view-prev':
      case 'view-next': {
        e.preventDefault();
        const order: ViewName[] = ['now', 'scheduled', 'someday'];
        const i = order.indexOf(s.view);
        const j = Math.min(
          order.length - 1,
          Math.max(0, i + (action === 'view-next' ? 1 : -1)),
        );
        if (j !== i) void this.controller.setView(order[j]);
        break;
      }
      case 'next':
        e.preventDefault();
        view?.moveSelection(1);
        break;
      case 'prev':
        e.preventDefault();
        view?.moveSelection(-1);
        break;
      case 'edit':
        e.preventDefault();
        view?.editSelected();
        break;
      case 'complete':
        e.preventDefault();
        view?.completeSelected();
        break;
      case 'snooze':
      case 'postpone':
        // `s`, `p` and `d` all open the Postpone route for the selected task.
        e.preventDefault();
        view?.snoozeSelected();
        break;
      case 'rename':
        // `r` opens the edit screen (which focuses the title field on mount).
        e.preventDefault();
        view?.editSelected();
        break;
      case 'undo': {
        e.preventDefault();
        const did = view?.undoLast() ?? false;
        if (!did) this.controller.showToast('Nothing to undo');
        break;
      }
      case 'escape':
        // Close search / clear selection if the list has something to close.
        view?.handleEscape();
        break;
      case 'help':
        e.preventDefault();
        this.helpOpen = true;
        break;
    }
  };

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
        @task-now=${(e: CustomEvent<{ task: Task }>) =>
          void this.controller.moveToNow(e.detail.task)}
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
      ${this.helpOpen && s.screen === 'list' && this.route.name === 'list'
        ? this.renderHelp()
        : nothing}
    `;
  }

  /** The keyboard-shortcuts help overlay (desktop). */
  private renderHelp() {
    const rows: Array<[unknown, string]> = [
      [html`<kbd>a</kbd>`, 'Add task'],
      [html`<kbd>/</kbd>`, 'Search'],
      [html`<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>`, 'Now / Scheduled / Someday'],
      [html`<kbd>j</kbd> <kbd>↓</kbd>`, 'Next task'],
      [html`<kbd>k</kbd> <kbd>↑</kbd>`, 'Previous task'],
      [html`<kbd>e</kbd> <kbd>Enter</kbd>`, 'Edit selected task'],
      [html`<kbd>r</kbd>`, 'Rename (edit) selected task'],
      [html`<kbd>c</kbd> <kbd>x</kbd>`, 'Complete selected task'],
      [html`<kbd>s</kbd> <kbd>p</kbd> <kbd>d</kbd>`, 'Postpone selected task'],
      [html`<kbd>u</kbd>`, 'Undo last complete'],
      [html`<kbd>Esc</kbd>`, 'Close search / clear selection'],
      [html`<kbd>?</kbd>`, 'Toggle this help'],
    ];
    return html`<div
      class="help-scrim"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) this.helpOpen = false;
      }}
    >
      <div class="help-panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div class="help-head">
          <h2>Keyboard shortcuts</h2>
          <button
            class="help-close"
            type="button"
            aria-label="Close"
            @click=${() => (this.helpOpen = false)}
          >
            ✕
          </button>
        </div>
        <dl class="help-list">
          ${rows.map(([keys, label]) => html`<dt>${keys}</dt>
            <dd>${label}</dd>`)}
        </dl>
      </div>
    </div>`;
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
            .defaultListId=${s.lists[0]?.id ?? ''}
            .somedayListId=${s.somedayListId}
            .onSubmit=${(input: {
              taskListId: string;
              title: string;
              due?: string;
              notes?: string;
            }) => this.controller.addTask(input)}
          ></add-task-screen>`;
        }
        if (this.route.name === 'edit') {
          const { listId, taskId } = this.route.params;
          const task = s.allTasks.find((t) => t.taskListId === listId && t.id === taskId);
          if (task) {
            return html`<edit-task-screen
              .task=${task}
              .lists=${s.lists}
              .somedayListId=${s.somedayListId}
              .onSave=${(changes: TaskUpdateChanges) =>
                this.controller.updateTask(task, changes)}
            ></edit-task-screen>`;
          }
          // Stale/deep-linked hash to a task we don't hold (e.g. it was completed
          // elsewhere): drop back to the list rather than render an empty editor.
          navigate('list');
        }
        if (this.route.name === 'snooze') {
          const { listId, taskId } = this.route.params;
          const task = s.allTasks.find((t) => t.taskListId === listId && t.id === taskId);
          if (task) {
            return html`<snooze-screen
              .task=${task}
              .somedayListId=${s.somedayListId}
            ></snooze-screen>`;
          }
          // Stale/deep-linked hash to a task we no longer hold: back to the list.
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
