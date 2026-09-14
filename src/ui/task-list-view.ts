import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { GroupedTasks, Task, TaskList, ViewName } from '../types';
import { groupScheduled } from '../logic/scheduledGroups.js';
import { partitionSearch } from '../logic/search.js';
import type { SearchSections } from '../logic/search.js';
import './task-card.js';
import './add-task-dialog.js';
import type { AddTaskDialog, AddTaskInput } from './add-task-dialog.js';

interface ViewDef {
  key: ViewName;
  label: string;
  icon: string; // SVG path data
}

/** The two display views and their switcher icons. */
const VIEWS: ViewDef[] = [
  // Inbox / list icon.
  {
    key: 'default',
    label: 'List',
    icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H5V5h14v10z',
  },
  // Calendar icon.
  {
    key: 'future',
    label: 'Scheduled',
    icon: 'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z',
  },
];

/**
 * The main authenticated screen: a header with a 2-way view switcher, optional
 * offline/cache banner, and a flat, full-bleed, swipeable task list. Purely
 * presentational — it renders props and dispatches `open-settings`, `refresh`
 * and `set-view`. Per-card `task-complete` / `task-snooze` events bubble past it
 * to the app.
 */
@customElement('task-list-view')
export class TaskListView extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .wrap {
      max-width: var(--app-max-width);
      margin: 0 auto;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      background: var(--app-header-bg);
      border-bottom: 1px solid var(--app-border);
    }
    .titlebar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      padding-top: max(12px, env(safe-area-inset-top, 0px));
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
      width: 22px;
      height: 22px;
      fill: currentColor;
    }
    .iconbtn.spin svg {
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .viewswitch {
      display: flex;
      gap: 4px;
      padding: 0 12px 10px;
    }
    .viewswitch button {
      flex: 1;
      appearance: none;
      border: none;
      background: transparent;
      color: var(--app-on-surface-muted);
      padding: 8px 6px;
      border-radius: 8px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 500;
    }
    .viewswitch button svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
      flex: none;
    }
    .viewswitch button[aria-pressed='true'] {
      background: color-mix(in srgb, var(--app-accent) 14%, transparent);
      color: var(--app-accent);
    }
    .viewswitch button:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: -2px;
    }
    .iconbtn[aria-pressed='true'] {
      background: color-mix(in srgb, var(--app-accent) 14%, transparent);
      color: var(--app-accent);
    }
    .searchbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 12px 10px;
    }
    .searchbar input {
      flex: 1;
      min-width: 0;
      appearance: none;
      border: 1px solid var(--app-border);
      background: var(--app-surface);
      color: var(--app-on-surface);
      border-radius: 8px;
      padding: 9px 12px;
      font-size: 0.9rem;
      font-family: inherit;
    }
    .searchbar input::placeholder {
      color: var(--app-on-surface-muted);
    }
    .searchbar input:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: -1px;
      border-color: transparent;
    }
    .nomatch {
      padding: 8px 16px 16px;
      color: var(--app-on-surface-muted);
      font-size: 0.9rem;
    }
    .banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      font-size: 0.8rem;
      background: color-mix(in srgb, var(--app-snooze) 22%, var(--app-surface));
      color: var(--app-on-surface);
      border-bottom: 1px solid var(--app-border);
    }
    main {
      flex: 1;
      /* Rows stay full-bleed (edge-to-edge). Vertical padding is theme-driven so
         the Inbox theme can give its elevated cards a little breathing room. */
      padding: var(--app-list-pad, 0);
      /* Leave room to scroll the last row's snooze button clear of the fixed FAB
         (56px + 16px inset). Longhand wins over the shorthand above. */
      padding-bottom: max(88px, calc(88px + env(safe-area-inset-bottom, 0px)));
    }
    .list {
      display: flex;
      flex-direction: column;
    }
    .grouphead {
      margin: 0;
      padding: 16px 16px 6px;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--app-on-surface-muted);
    }
    .grouphead:first-child {
      padding-top: 8px;
    }
    .empty {
      text-align: center;
      padding: 64px 24px;
      color: var(--app-on-surface-muted);
    }
    .empty .big {
      font-size: 2.5rem;
      margin-bottom: 8px;
    }
    .empty h2 {
      font-size: 1.1rem;
      margin: 0 0 4px;
      color: var(--app-on-surface);
    }
    .fab {
      position: fixed;
      right: max(16px, env(safe-area-inset-right, 0px));
      bottom: max(16px, calc(16px + env(safe-area-inset-bottom, 0px)));
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      background: var(--app-accent);
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 3px 8px rgba(60, 64, 67, 0.35), 0 1px 3px rgba(60, 64, 67, 0.25);
      z-index: 20;
    }
    .fab:hover {
      background: color-mix(in srgb, var(--app-accent) 88%, #000);
    }
    .fab:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: 2px;
    }
    .fab svg {
      width: 26px;
      height: 26px;
      fill: currentColor;
    }
  `;

  @property({ attribute: false }) grouped: GroupedTasks = {
    overdue: [],
    today: [],
    noDate: [],
  };
  @property({ attribute: false }) allTasks: Task[] = [];
  @property() view: ViewName = 'default';
  @property({ type: Boolean }) offline = false;
  @property({ type: Boolean }) fromCache = false;
  @property({ type: Boolean }) loading = false;
  @property({ type: Number }) fetchedAt: number | null = null;
  /** All the user's lists, in Google order (default list first). */
  @property({ attribute: false }) lists: TaskList[] = [];
  /** Async add-task handler wired to controller.addTask by the shell. */
  @property({ attribute: false }) addTask?: (input: AddTaskInput) => Promise<void>;

  @query('add-task-dialog') private addDialog?: AddTaskDialog;
  @query('#searchinput') private searchInput?: HTMLInputElement;

  /** Whether the header search field is expanded. */
  @state() private searchOpen = false;
  /** The transient (never persisted) search query. */
  @state() private searchQuery = '';

  private openAddDialog(): void {
    this.addDialog?.show();
  }

  private toggleSearch(): void {
    this.searchOpen = !this.searchOpen;
    if (this.searchOpen) {
      void this.updateComplete.then(() => this.searchInput?.focus());
    } else {
      this.searchQuery = '';
    }
  }

  private onSearchInput(e: Event): void {
    this.searchQuery = (e.target as HTMLInputElement).value;
  }

  private onSearchKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.searchQuery = '';
      this.searchOpen = false;
    }
  }

  private clearSearch(): void {
    this.searchQuery = '';
    void this.updateComplete.then(() => this.searchInput?.focus());
  }

  /** Today's LOCAL calendar date as 'YYYY-MM-DD'. */
  private todayStr(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** The flat, ordered list of tasks to show for the current view. */
  private visibleTasks(): Task[] {
    if (this.view === 'future') {
      const today = this.todayStr();
      return this.allTasks
        .filter((t) => t.due !== null && t.due.slice(0, 10) > today)
        .sort((a, b) => ((a.due as string) < (b.due as string) ? -1 : (a.due as string) > (b.due as string) ? 1 : 0));
    }
    // default: overdue first, then today, then no-date.
    return [...this.grouped.overdue, ...this.grouped.today, ...this.grouped.noDate];
  }

  private emptyState(): { big: string; heading: string; body: string } {
    switch (this.view) {
      case 'future':
        return {
          big: '📅',
          heading: 'Nothing scheduled ahead',
          body: 'Tasks due after today will appear here.',
        };
      default:
        return {
          big: '✓',
          heading: 'All clear',
          body: 'Nothing due today or overdue. Inbox zero.',
        };
    }
  }

  private cacheLabel(): string {
    if (!this.fetchedAt) return '';
    const when = new Date(this.fetchedAt).toLocaleString();
    return `Showing cached tasks from ${when}`;
  }

  private setView(view: ViewName): void {
    this.dispatchEvent(
      new CustomEvent('set-view', { detail: view, bubbles: true, composed: true }),
    );
  }

  /** Future tasks grouped into date buckets for the Scheduled view. */
  private futureGroups() {
    return groupScheduled(this.visibleTasks(), new Date());
  }

  /** The two-section result list shown while a search query is active. */
  private renderSearchResults(sections: SearchSections) {
    return html`
      <div class="list">
        <h2 class="grouphead">In this view</h2>
        ${sections.inView.length === 0
          ? html`<div class="nomatch">No matches in this view</div>`
          : repeat(
              sections.inView,
              (t) => t.id,
              (t) => html`<task-card .task=${t}></task-card>`,
            )}
        ${sections.other.length > 0
          ? html`
              <h2 class="grouphead">Other matches</h2>
              ${repeat(
                sections.other,
                (t) => t.id,
                (t) => html`<task-card .task=${t}></task-card>`,
              )}
            `
          : nothing}
      </div>
    `;
  }

  render() {
    const tasks = this.visibleTasks();
    const empty = this.emptyState();
    const searching = this.searchQuery.trim() !== '';
    const groups = !searching && this.view === 'future' ? this.futureGroups() : [];
    const sections = searching
      ? partitionSearch(tasks, this.allTasks, this.searchQuery)
      : null;
    return html`
      <div class="wrap">
        <header>
          <div class="titlebar">
            <h1>Swipe GT</h1>
            <button
              class="iconbtn"
              aria-label="Search"
              aria-pressed=${this.searchOpen}
              @click=${() => this.toggleSearch()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"
                />
              </svg>
            </button>
            <button
              class="iconbtn ${this.loading ? 'spin' : ''}"
              aria-label="Refresh"
              @click=${() =>
                this.dispatchEvent(
                  new CustomEvent('refresh', { bubbles: true, composed: true }),
                )}
            >
              <svg viewBox="0 0 24 24">
                <path
                  d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"
                />
              </svg>
            </button>
            <button
              class="iconbtn"
              aria-label="Settings"
              @click=${() =>
                this.dispatchEvent(
                  new CustomEvent('open-settings', { bubbles: true, composed: true }),
                )}
            >
              <svg viewBox="0 0 24 24">
                <path
                  d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
                />
              </svg>
            </button>
          </div>
          ${this.searchOpen
            ? html`<div class="searchbar">
                <input
                  id="searchinput"
                  type="search"
                  inputmode="search"
                  autocomplete="off"
                  aria-label="Search tasks"
                  placeholder="Search tasks…"
                  .value=${this.searchQuery}
                  @input=${(e: Event) => this.onSearchInput(e)}
                  @keydown=${(e: KeyboardEvent) => this.onSearchKeydown(e)}
                />
                ${this.searchQuery
                  ? html`<button
                      class="iconbtn"
                      aria-label="Clear search"
                      @click=${() => this.clearSearch()}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                        />
                      </svg>
                    </button>`
                  : nothing}
              </div>`
            : nothing}
          <div class="viewswitch" role="group" aria-label="View">
            ${VIEWS.map(
              (v) => html`
                <button
                  aria-pressed=${this.view === v.key}
                  aria-label=${v.label}
                  @click=${() => this.setView(v.key)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${v.icon} /></svg>
                  <span>${v.label}</span>
                </button>
              `,
            )}
          </div>
        </header>

        ${this.offline
          ? html`<div class="banner" role="status">
              <span>You're offline — changes will sync when you reconnect.</span>
            </div>`
          : nothing}
        ${this.fromCache && !this.offline
          ? html`<div class="banner" role="status">${this.cacheLabel()}</div>`
          : nothing}

        <main>
          ${sections
            ? this.renderSearchResults(sections)
            : tasks.length === 0
              ? html`<div class="empty">
                  <div class="big" aria-hidden="true">${empty.big}</div>
                  <h2>${empty.heading}</h2>
                  <p>${empty.body}</p>
                </div>`
              : this.view === 'future'
                ? html`<div class="list">
                    ${groups.map(
                      (g) => html`
                        <h2 class="grouphead">${g.label}</h2>
                        ${repeat(
                          g.tasks,
                          (t) => t.id,
                          (t) => html`<task-card .task=${t}></task-card>`,
                        )}
                      `,
                    )}
                  </div>`
                : html`<div class="list">
                    ${repeat(
                      tasks,
                      (t) => t.id,
                      (t) => html`<task-card .task=${t}></task-card>`,
                    )}
                  </div>`}
        </main>

        <button class="fab" aria-label="Add task" @click=${() => this.openAddDialog()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />
          </svg>
        </button>
        <add-task-dialog
          .lists=${this.lists}
          .onSubmit=${this.addTask}
        ></add-task-dialog>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'task-list-view': TaskListView;
  }
}
