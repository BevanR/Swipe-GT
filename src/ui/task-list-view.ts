import { LitElement, css, html, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { GroupedTasks, Task, TaskList, ViewName } from '../types';
import { groupScheduled } from '../logic/scheduledGroups.js';
import { scheduledDueDisplay } from '../logic/scheduledDueDisplay.js';
import { partitionSearch } from '../logic/search.js';
import type { SearchSections } from '../logic/search.js';
import { nextId, resolveActingId } from '../logic/selection.js';
import { NOW_EMPTY, SOMEDAY_EMPTY, pickEmpty } from './emptyMessages.js';
import type { EmptyMessage } from './emptyMessages.js';
import { navigate } from '../app/router.js';
import './task-card.js';
import type { TaskCard } from './task-card.js';

interface ViewDef {
  key: ViewName;
  label: string;
  icon: string; // SVG path data
}

/** The three display views and their switcher icons. */
const VIEWS: ViewDef[] = [
  // Now — inbox / list icon.
  {
    key: 'now',
    label: 'Now',
    icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H5V5h14v10z',
  },
  // Scheduled — calendar icon.
  {
    key: 'scheduled',
    label: 'Scheduled',
    icon: 'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z',
  },
  // Someday — archive box icon.
  {
    key: 'someday',
    label: 'Someday',
    icon: 'M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z',
  },
];

/**
 * Session-stable empty-state picks, one per view (only `now` and `someday` are
 * varied; `scheduled` is a fixed line). Held at MODULE scope so a pick survives
 * this component being torn down and recreated as the user navigates away and
 * back — a component-instance field would re-roll on every remount. Chosen
 * lazily the first time each view's empty state renders and then kept for the
 * app's lifetime (a full reload starts fresh, which is fine).
 */
const emptyPickCache: Partial<Record<ViewName, EmptyMessage>> = {};

/**
 * The main authenticated screen: a header with a 3-way view switcher (Now /
 * Scheduled / Someday), optional offline/cache banner, and a flat, full-bleed,
 * swipeable task list. Purely presentational — it renders props and dispatches
 * `open-settings`, `refresh` and `set-view`. Per-card `task-complete` /
 * `task-snooze` / `task-someday` events bubble past it to the app.
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
      padding: 72px 24px;
      color: var(--app-on-surface-muted);
      display: flex;
      flex-direction: column;
      align-items: center;
      animation: empty-in 0.42s cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
    .empty .big {
      font-size: 3.5rem;
      line-height: 1;
      margin-bottom: 12px;
      animation: empty-pop 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both;
    }
    .empty h2 {
      font-size: 1.15rem;
      margin: 0 0 4px;
      color: var(--app-on-surface);
    }
    .empty p {
      margin: 0;
      max-width: 22rem;
    }
    @keyframes empty-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    @keyframes empty-pop {
      from {
        opacity: 0;
        transform: scale(0.6);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .empty,
      .empty .big {
        animation: none;
      }
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
  /** Future-dated tasks for the Scheduled view (sorted by due asc). */
  @property({ attribute: false }) scheduled: Task[] = [];
  /** Dateless Someday-list tasks for the Someday view (by position asc). */
  @property({ attribute: false }) someday: Task[] = [];
  @property({ attribute: false }) allTasks: Task[] = [];
  @property() view: ViewName = 'now';
  /** The designated Someday list id (or null); threaded down to each card. */
  @property({ attribute: false }) somedayListId: string | null = null;
  @property({ type: Boolean }) offline = false;
  @property({ type: Boolean }) fromCache = false;
  @property({ type: Boolean }) loading = false;
  @property({ type: Number }) fetchedAt: number | null = null;
  /** All the user's lists, in Google order (default list first). */
  @property({ attribute: false }) lists: TaskList[] = [];

  @query('#searchinput') private searchInput?: HTMLInputElement;

  /** Whether the header search field is expanded. */
  @state() private searchOpen = false;
  /** The transient (never persisted) search query. */
  @state() private searchQuery = '';
  /**
   * The keyboard-selected task's id, or null when nothing is selected. Drives
   * the per-card `selected` highlight and is the anchor for j/k navigation and
   * the task-acting shortcuts (edit/complete/snooze). Reset when the view
   * changes or the selected task leaves the visible set (see {@link willUpdate}).
   */
  @state() private selectedTaskId: string | null = null;

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

  /**
   * The flat, ordered list of tasks for the current view — the exact membership
   * of each view (from the controller's partition), in display order. Used for
   * the flat Now/Someday renders and as the "in this view" set for search.
   */
  private visibleTasks(): Task[] {
    switch (this.view) {
      case 'scheduled':
        return this.scheduled;
      case 'someday':
        return this.someday;
      case 'now':
      default:
        // Now: overdue first, then today, then no-date.
        return [...this.grouped.overdue, ...this.grouped.today, ...this.grouped.noDate];
    }
  }

  /**
   * The tasks currently rendered, in exact top-to-bottom DOM order — the flat
   * sequence keyboard navigation walks. Mirrors {@link render}'s branching:
   *  - searching: the two sections, `inView` then `other`;
   *  - `scheduled` (no search): the date buckets flattened in display order;
   *  - otherwise: the flat view list.
   */
  private orderedVisibleTasks(): Task[] {
    if (this.searchQuery.trim() !== '') {
      const sections = partitionSearch(this.visibleTasks(), this.allTasks, this.searchQuery);
      return [...sections.inView, ...sections.other];
    }
    if (this.view === 'scheduled') {
      return this.futureGroups().flatMap((g) => g.tasks);
    }
    return this.visibleTasks();
  }

  /** The ids of {@link orderedVisibleTasks}, in display order. */
  private visibleIds(): string[] {
    return this.orderedVisibleTasks().map((t) => t.id);
  }

  /** The mounted <task-card> for `id`, or null when it isn't rendered. */
  private cardFor(id: string | null): TaskCard | null {
    if (id == null) return null;
    const cards = this.renderRoot.querySelectorAll<TaskCard>('task-card');
    for (const c of cards) if (c.task?.id === id) return c;
    return null;
  }

  /**
   * Keep the selection coherent as data/view changes: clear it on a view switch,
   * and drop it if the selected task is no longer visible (completed elsewhere,
   * filtered out by search, etc.). Runs before render so the highlight and
   * scroll reflect the resolved selection.
   */
  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('view')) {
      this.selectedTaskId = null;
    }
    if (this.selectedTaskId != null && !this.visibleIds().includes(this.selectedTaskId)) {
      this.selectedTaskId = null;
    }
  }

  /** Scroll the freshly-selected card into view (nearest edge, no jump). */
  protected updated(changed: PropertyValues): void {
    if (changed.has('selectedTaskId') && this.selectedTaskId != null) {
      this.cardFor(this.selectedTaskId)?.scrollIntoView({ block: 'nearest' });
    }
  }

  // --- keyboard entry points (called by app-root's global key handler) ------

  /** Open + focus the search box (the `/` shortcut). */
  openSearchFromKeyboard(): void {
    if (!this.searchOpen) this.searchOpen = true;
    void this.updateComplete.then(() => this.searchInput?.focus());
  }

  /**
   * Move the selection by `delta` down (+1) / up (-1) the visible list, clamping
   * at the ends. With nothing selected (or an unknown selection) this lands on
   * the first visible task.
   */
  moveSelection(delta: number): void {
    this.selectedTaskId = nextId(this.visibleIds(), this.selectedTaskId, delta);
  }

  /** Edit the selected task (or the first visible one if none is selected). */
  editSelected(): void {
    const id = resolveActingId(this.visibleIds(), this.selectedTaskId);
    if (id == null) return;
    this.selectedTaskId = id;
    const task = this.orderedVisibleTasks().find((t) => t.id === id);
    if (task) navigate('edit', { listId: task.taskListId, taskId: task.id });
  }

  /**
   * Complete the selected task (or the first visible one) through the card's
   * normal complete path, so the in-gap Undo window still applies.
   */
  completeSelected(): void {
    const id = resolveActingId(this.visibleIds(), this.selectedTaskId);
    if (id == null) return;
    this.selectedTaskId = id;
    this.cardFor(id)?.completeFromKeyboard();
  }

  /** Open the snooze menu on the selected task (or the first visible one). */
  snoozeSelected(): void {
    const id = resolveActingId(this.visibleIds(), this.selectedTaskId);
    if (id == null) return;
    this.selectedTaskId = id;
    this.cardFor(id)?.openSnoozeFromKeyboard();
  }

  /**
   * Undo the most recent in-gap completion, if any card still holds one. Returns
   * true when an undo fired (so the caller can decide whether to toast).
   */
  undoLast(): boolean {
    const cards = this.renderRoot.querySelectorAll<TaskCard>('task-card');
    for (const c of cards) {
      if (c.hasPendingUndo) return c.undoFromKeyboard();
    }
    return false;
  }

  /**
   * Escape on the list: close the search box if open, otherwise clear the
   * selection. Returns true when it consumed the key.
   */
  handleEscape(): boolean {
    if (this.searchOpen) {
      this.searchQuery = '';
      this.searchOpen = false;
      return true;
    }
    if (this.selectedTaskId != null) {
      this.selectedTaskId = null;
      return true;
    }
    return false;
  }

  /**
   * The empty-state message for `view`. Now and Someday get a varied cheerful
   * message; Scheduled keeps its single fixed line. Each view's varied pick is
   * chosen ONCE (the first time that view's empty state renders) and then kept
   * for the app's lifetime via the module-scoped {@link emptyPickCache}, so it
   * never reshuffles on re-render, view switches, or navigation away and back.
   */
  private pickEmptyFor(view: ViewName): EmptyMessage {
    if (view === 'scheduled') {
      return {
        emoji: '📅',
        title: 'Nothing scheduled ahead',
        subtitle: 'Tasks due after today will appear here.',
      };
    }
    let pick = emptyPickCache[view];
    if (!pick) {
      pick = pickEmpty(view === 'someday' ? SOMEDAY_EMPTY : NOW_EMPTY);
      emptyPickCache[view] = pick;
    }
    return pick;
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
    return groupScheduled(this.scheduled, new Date());
  }

  /**
   * The friendly empty state: a big decorative emoji, a bold title, and a muted
   * subtitle, centered. The emoji is aria-hidden (decorative); the title and
   * subtitle carry the message as real text. Now/Someday get a varied cheerful
   * variant; Scheduled keeps its fixed line.
   */
  private renderEmpty() {
    const msg = this.pickEmptyFor(this.view);
    return html`<div class="empty" role="status">
      <div class="big" aria-hidden="true">${msg.emoji}</div>
      <h2>${msg.title}</h2>
      <p>${msg.subtitle}</p>
    </div>`;
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
              (t) =>
                html`<task-card
                  .task=${t}
                  .somedayListId=${this.somedayListId}
                  ?selected=${t.id === this.selectedTaskId}
                ></task-card>`,
            )}
        ${sections.other.length > 0
          ? html`
              <h2 class="grouphead">Other matches</h2>
              ${repeat(
                sections.other,
                (t) => t.id,
                (t) =>
                  html`<task-card
                    .task=${t}
                    .somedayListId=${this.somedayListId}
                    ?selected=${t.id === this.selectedTaskId}
                  ></task-card>`,
              )}
            `
          : nothing}
      </div>
    `;
  }

  render() {
    const tasks = this.visibleTasks();
    const searching = this.searchQuery.trim() !== '';
    const groups = !searching && this.view === 'scheduled' ? this.futureGroups() : [];
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
              ? this.renderEmpty()
              : this.view === 'scheduled'
                ? html`<div class="list">
                    ${groups.map(
                      (g) => html`
                        <h2 class="grouphead">${g.label}</h2>
                        ${repeat(
                          g.tasks,
                          (t) => t.id,
                          (t) =>
                            html`<task-card
                              .task=${t}
                              .somedayListId=${this.somedayListId}
                              .dueDisplay=${scheduledDueDisplay(g.key, t.due)}
                              ?selected=${t.id === this.selectedTaskId}
                            ></task-card>`,
                        )}
                      `,
                    )}
                  </div>`
                : html`<div class="list">
                    ${repeat(
                      tasks,
                      (t) => t.id,
                      (t) =>
                        html`<task-card
                          .task=${t}
                          .somedayListId=${this.somedayListId}
                          ?selected=${t.id === this.selectedTaskId}
                        ></task-card>`,
                    )}
                  </div>`}
        </main>

        <button class="fab" aria-label="Add task" @click=${() => navigate('add')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />
          </svg>
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'task-list-view': TaskListView;
  }
}
