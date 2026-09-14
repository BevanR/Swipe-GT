import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GroupedTasks, Task } from '../types';
import './task-card.js';

interface Group {
  heading: string;
  tasks: Task[];
}

/**
 * The main authenticated screen: a header, optional offline/cache banner, and
 * the grouped, swipeable task list (Overdue / Today / No date). Purely
 * presentational — it renders props and dispatches `open-settings` / `refresh`.
 * The per-card `task-complete` / `task-snooze` events bubble past it to the app.
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
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px calc(12px + env(safe-area-inset-top, 0px));
      padding-top: max(12px, env(safe-area-inset-top, 0px));
      background: var(--app-header-bg);
      border-bottom: 1px solid var(--app-border);
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
      padding: 12px 16px 32px;
    }
    section {
      margin-bottom: var(--app-group-gap);
    }
    .heading {
      font-size: var(--app-section-size);
      font-weight: var(--app-section-weight);
      text-transform: var(--app-section-transform);
      letter-spacing: var(--app-section-spacing);
      color: var(--app-section-color);
      margin: 0 2px 8px;
    }
    .cards {
      display: flex;
      flex-direction: column;
      gap: var(--app-list-gap);
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
  @property({ type: Boolean }) offline = false;
  @property({ type: Boolean }) fromCache = false;
  @property({ type: Boolean }) loading = false;
  @property({ type: Number }) fetchedAt: number | null = null;

  private get isEmpty(): boolean {
    const { overdue, today, noDate } = this.grouped;
    return overdue.length + today.length + noDate.length === 0;
  }

  private groups(): Group[] {
    return [
      { heading: 'Overdue', tasks: this.grouped.overdue },
      { heading: 'Today', tasks: this.grouped.today },
      { heading: 'No date', tasks: this.grouped.noDate },
    ].filter((g) => g.tasks.length > 0);
  }

  private cacheLabel(): string {
    if (!this.fetchedAt) return '';
    const when = new Date(this.fetchedAt).toLocaleString();
    return `Showing cached tasks from ${when}`;
  }

  render() {
    return html`
      <div class="wrap">
        <header>
          <h1>Tasks</h1>
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
          ${this.isEmpty
            ? html`<div class="empty">
                <div class="big" aria-hidden="true">✓</div>
                <h2>All clear</h2>
                <p>Nothing due today or overdue. Inbox zero.</p>
              </div>`
            : this.groups().map(
                (g) => html`
                  <section>
                    <div class="heading">${g.heading}</div>
                    <div class="cards">
                      ${g.tasks.map(
                        (t) => html`<task-card .task=${t}></task-card>`,
                      )}
                    </div>
                  </section>
                `,
              )}
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
