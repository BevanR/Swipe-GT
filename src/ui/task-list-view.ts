import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GroupedTasks, Task, ViewName } from '../types';
import './task-card.js';

interface ViewDef {
  key: ViewName;
  label: string;
  icon: string; // SVG path data
}

/** The three display views and their switcher icons. */
const VIEWS: ViewDef[] = [
  // Inbox / list icon.
  {
    key: 'default',
    label: 'List',
    icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H5V5h14v10z',
  },
  // Star icon.
  {
    key: 'starred',
    label: 'Starred',
    icon: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  },
  // Calendar icon.
  {
    key: 'future',
    label: 'Scheduled',
    icon: 'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z',
  },
];

/**
 * The main authenticated screen: a header with a 3-way view switcher, optional
 * offline/cache banner, and a flat, full-bleed, swipeable task list. Purely
 * presentational — it renders props and dispatches `open-settings`, `refresh`
 * and `set-view`. Per-card `task-complete` / `task-snooze` / `task-star` events
 * bubble past it to the app.
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
      /* Full-bleed: rows go edge-to-edge, no outer padding, no gaps. */
      padding: 0;
    }
    .list {
      display: flex;
      flex-direction: column;
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
  `;

  @property({ attribute: false }) grouped: GroupedTasks = {
    overdue: [],
    today: [],
    noDate: [],
  };
  @property({ attribute: false }) allTasks: Task[] = [];
  @property({ attribute: false }) starredIds: string[] = [];
  @property() view: ViewName = 'default';
  @property({ type: Boolean }) offline = false;
  @property({ type: Boolean }) fromCache = false;
  @property({ type: Boolean }) loading = false;
  @property({ type: Number }) fetchedAt: number | null = null;

  /** Today's LOCAL calendar date as 'YYYY-MM-DD'. */
  private todayStr(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** The flat, ordered list of tasks to show for the current view. */
  private visibleTasks(): Task[] {
    if (this.view === 'starred') {
      const starred = new Set(this.starredIds);
      return this.allTasks.filter((t) => starred.has(t.id));
    }
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
      case 'starred':
        return { big: '☆', heading: 'No starred tasks', body: 'Star a task to keep it here.' };
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

  render() {
    const tasks = this.visibleTasks();
    const starred = new Set(this.starredIds);
    const empty = this.emptyState();
    return html`
      <div class="wrap">
        <header>
          <div class="titlebar">
            <h1>Swipe GT</h1>
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
                  d="M19.14 12.94a7.5 7.5 0 0 0 .05-1.88l2.03-1.58-2-3.46-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54h-4l-.36 2.54c-.58.24-1.12.56-1.62.94l-2.39-.96-2 3.46 2.03 1.58a7.5 7.5 0 0 0 0 1.88l-2.03 1.58 2 3.46 2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54h4l.36-2.54c.58-.24 1.12-.56 1.62-.94l2.39.96 2-3.46-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
                />
              </svg>
            </button>
          </div>
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
          ${tasks.length === 0
            ? html`<div class="empty">
                <div class="big" aria-hidden="true">${empty.big}</div>
                <h2>${empty.heading}</h2>
                <p>${empty.body}</p>
              </div>`
            : html`<div class="list">
                ${tasks.map(
                  (t) => html`<task-card
                    .task=${t}
                    ?starred=${starred.has(t.id)}
                  ></task-card>`,
                )}
              </div>`}
        </main>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'task-list-view': TaskListView;
  }
}
