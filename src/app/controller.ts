import { AuthClient, SilentRenewFailedError } from '../auth/authClient';
import { TasksApi } from '../api/tasksApi';
import {
  getConfig,
  getSnapshot,
  setConfig,
  setSnapshot,
} from '../storage/db';
import { drainQueue, enqueueMutation } from '../pwa/offlineQueue';
import { partitionViews } from '../logic/views';
import type {
  Task,
  TaskList,
  ThemeName,
  ViewName,
} from '../types';
import { EMPTY_GROUPS, initialState, type AppState } from './state';

/** Minimal auth surface the controller needs — lets tests inject a fake. */
export interface AuthLike {
  connect(): Promise<unknown>;
  getValidAccessToken(): Promise<string>;
  isConnected(): Promise<boolean>;
}

/** Minimal API surface the controller needs — lets tests inject a fake. */
export interface ApiLike {
  listTaskLists(): Promise<{ id: string; title: string }[]>;
  listTasks(taskListId: string, taskListTitle?: string): Promise<Task[]>;
  insert(
    taskListId: string,
    input: { title: string; due?: string; notes?: string },
    taskListTitle?: string,
  ): Promise<Task>;
  patchDue(taskListId: string, taskId: string, due: string): Promise<void>;
  complete(taskListId: string, taskId: string): Promise<void>;
  clearDue(taskListId: string, taskId: string): Promise<void>;
  updateTask(
    taskListId: string,
    taskId: string,
    changes: { title?: string; notes?: string; due?: string },
    taskListTitle?: string,
  ): Promise<Task>;
  deleteTask(taskListId: string, taskId: string): Promise<void>;
  move(
    taskListId: string,
    taskId: string,
    destinationTasklist: string,
    destinationTitle?: string,
  ): Promise<Task>;
}

/**
 * The field changes the Edit screen asks the controller to apply. Every field is
 * optional so unchanged fields are omitted:
 *  - `title` / `notes`: a new string value (notes may be `''`).
 *  - `due`: a 'YYYY-MM-DD' string to set the date, or `null` to CLEAR it (which
 *    is applied via {@link ApiLike.clearDue}); omitted means "leave the date".
 *  - `listId`: the destination list id when the task should MOVE lists.
 */
export interface TaskUpdateChanges {
  title?: string;
  notes?: string;
  due?: string | null;
  listId?: string;
}

/** Remembers where a task lived so an online failure can roll it back in. */
interface RemovedTask {
  task: Task;
  index: number;
}

/**
 * Heuristic: does this error look like Google refusing to MOVE a recurring task
 * between lists? The REST client throws an Error whose message includes the raw
 * Google error body, which mentions recurrence for this case.
 */
function isRecurringMoveError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /recurr/i.test(msg);
}

/**
 * Owns all app data flow: auth, fetching, filtering, optimistic mutations, the
 * offline queue, and the refresh triggers. Emits a 'change' event whenever
 * {@link state} changes; the UI subscribes and re-renders.
 */
export class AppController extends EventTarget {
  private _state: AppState;
  private readonly auth: AuthLike;
  private readonly api: ApiLike;
  /** True once the browser-event listeners are wired (idempotent boot). */
  private listenersWired = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts?: { auth?: AuthLike; api?: ApiLike; theme?: ThemeName }) {
    super();
    const authClient = opts?.auth ?? new AuthClient();
    this.auth = authClient;
    this.api =
      opts?.api ?? new TasksApi(() => (authClient as AuthClient).getValidAccessToken());
    this._state = initialState(opts?.theme ?? 'tasks');
  }

  get state(): AppState {
    return this._state;
  }

  private patch(partial: Partial<AppState>): void {
    this._state = { ...this._state, ...partial };
    this.dispatchEvent(new Event('change'));
  }

  // --- boot / auth ---------------------------------------------------------

  /** Entry point: apply theme, wire triggers, then connect-or-load. */
  async boot(): Promise<void> {
    const cfg = await getConfig();
    this.applyTheme(cfg.theme);
    this.patch({
      theme: cfg.theme,
      view: cfg.view,
      somedayListId: cfg.somedayListId,
    });
    this.wireRefreshTriggers();

    if (await this.auth.isConnected()) {
      await this.load();
    } else {
      this.patch({ screen: 'connect', connectError: false });
    }
  }

  /** Interactive Google sign-in, then load. */
  async connect(): Promise<void> {
    this.patch({ connectError: false });
    try {
      await this.auth.connect();
    } catch {
      this.patch({ connectError: true });
      return;
    }
    this.patch({ screen: 'loading' });
    await this.load();
  }

  /** Disconnect: clear auth and return to the connect screen. */
  async disconnect(): Promise<void> {
    await setConfig({ auth: null });
    this.patch({
      screen: 'connect',
      grouped: EMPTY_GROUPS,
      scheduled: [],
      someday: [],
      allTasks: [],
      lists: [],
      fetchedAt: null,
      fromCache: false,
      connectError: false,
    });
  }

  // --- loading -------------------------------------------------------------

  /** Fetch all lists + tasks, partition into views, cache, and render. */
  async load(): Promise<void> {
    this.patch({ loading: true });
    try {
      const rawLists = await this.api.listTaskLists();
      const lists: TaskList[] = rawLists.map((l) => ({ id: l.id, title: l.title }));

      const tasks: Task[] = [];
      for (const list of lists) {
        const listTasks = await this.api.listTasks(list.id, list.title);
        tasks.push(...listTasks);
      }

      const fetchedAt = Date.now();
      await setSnapshot({ fetchedAt, tasks, lists });

      this.patch({
        lists,
        fetchedAt,
        fromCache: false,
        offline: false,
        loading: false,
      });
      this.setTasks(tasks);
      // Only jump to the list screen from loading/connect; keep settings open
      // if the user is there (a settings change re-runs load in the background).
      if (this._state.screen === 'loading' || this._state.screen === 'connect') {
        this.patch({ screen: 'list' });
      }
    } catch (err) {
      await this.handleLoadError(err);
    }
  }

  private async handleLoadError(err: unknown): Promise<void> {
    if (err instanceof SilentRenewFailedError) {
      // Silent renew failed — fall back to interactive re-auth, keeping any
      // queued offline mutations intact.
      this.patch({ screen: 'connect', connectError: false, loading: false });
      return;
    }
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    const snapshot = await getSnapshot();
    if (offline && snapshot) {
      this.patch({
        screen: this._state.screen === 'connect' ? 'list' : this._state.screen,
        lists: snapshot.lists,
        fetchedAt: snapshot.fetchedAt,
        fromCache: true,
        offline: true,
        loading: false,
      });
      this.setTasks(snapshot.tasks);
      if (this._state.screen === 'loading') this.patch({ screen: 'list' });
      return;
    }
    this.patch({ loading: false });
    this.showToast('Could not load tasks. Pull to refresh to retry.');
    if (this._state.screen === 'loading') {
      // Nothing to show and no cache — offer reconnect as a last resort.
      this.patch({ screen: 'list' });
    }
  }

  // --- mutations (optimistic) ---------------------------------------------

  /** Optimistically complete a task (card already animated out). */
  async completeTask(task: Task): Promise<void> {
    const removed = this.removeTask(task.id);
    try {
      await this.api.complete(task.taskListId, task.id);
      await this.refresh();
    } catch (err) {
      await this.handleMutationFailure(err, removed, {
        id: crypto.randomUUID(),
        type: 'complete',
        taskId: task.id,
        taskListId: task.taskListId,
        createdAt: Date.now(),
      });
    }
  }

  /** Optimistically snooze a task to `due` (card already animated out). */
  async snoozeTask(task: Task, due: string): Promise<void> {
    const removed = this.removeTask(task.id);
    try {
      await this.api.patchDue(task.taskListId, task.id, due);
      await this.refresh();
    } catch (err) {
      await this.handleMutationFailure(err, removed, {
        id: crypto.randomUUID(),
        type: 'snooze',
        taskId: task.id,
        taskListId: task.taskListId,
        due,
        createdAt: Date.now(),
      });
    }
  }

  /**
   * Park a task in the Someday list: clear its due date and move it into the
   * designated Someday list, so it lands in the Someday view. Requires a
   * configured `somedayListId` and connectivity.
   *
   * Order: move first, then clear the due date. Moving between lists is the
   * operation Google rejects for recurring tasks, so doing it first means such a
   * rejection leaves the task fully untouched server-side (a clean rollback)
   * before we ever change the due date.
   *
   * Offline move is out of scope: when offline we surface a toast and do NOT
   * enqueue (unlike complete/snooze).
   */
  async moveToSomeday(task: Task): Promise<void> {
    const somedayListId = this._state.somedayListId;
    if (!somedayListId) {
      this.showToast('Choose a Someday list in Settings first.');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // Offline move is out of scope: do NOT enqueue; just tell the user.
      this.showToast("Can't move to Someday while offline");
      return;
    }
    const somedayTitle = this._state.lists.find((l) => l.id === somedayListId)?.title;
    const removed = this.removeTask(task.id);
    try {
      const moved = await this.api.move(
        task.taskListId,
        task.id,
        somedayListId,
        somedayTitle,
      );
      if (moved.due !== null) {
        await this.api.clearDue(moved.taskListId, moved.id);
      }
      await this.refresh();
    } catch (err) {
      if (err instanceof SilentRenewFailedError) {
        this.patch({ screen: 'connect', connectError: false });
        return;
      }
      if (removed) this.restoreTask(removed);
      if (isRecurringMoveError(err)) {
        this.showToast("Recurring tasks can't be moved to Someday.");
      } else {
        this.showToast('Could not move to Someday. Try again.');
      }
    }
  }

  /**
   * Clear a task's due date (the "No date" snooze option). Clearing the date
   * changes which view the task belongs to — e.g. a Scheduled task becomes a Now
   * task — so we optimistically remove it from the current view, clear the date
   * via the API, then re-fetch so it reappears in its new home.
   *
   * Distinct from {@link moveToSomeday}: this ONLY clears the date and never
   * moves lists (a task already in the Someday list simply stays there, dateless
   * = the Someday view). Offline is out of scope (like add/someday/edit): we
   * toast and do NOT enqueue, with no optimistic removal to roll back since we
   * bail before touching state. Other online failures roll the card back in.
   */
  async clearTaskDate(task: Task): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // Offline is out of scope: do NOT enqueue; just tell the user.
      this.showToast("Can't do that while offline");
      return;
    }
    const removed = this.removeTask(task.id);
    try {
      await this.api.clearDue(task.taskListId, task.id);
      await this.refresh();
    } catch (err) {
      if (err instanceof SilentRenewFailedError) {
        if (removed) this.restoreTask(removed);
        this.patch({ screen: 'connect', connectError: false });
        return;
      }
      if (removed) this.restoreTask(removed);
      this.showToast('Something went wrong. Try again.');
    }
  }

  /**
   * Create a new task, then re-fetch so it lands in the correct view (Now if due
   * today/overdue/none, Scheduled if future). Requires connectivity and
   * auth — offline add is out of scope, so we surface an error rather than
   * enqueue. Rejects on failure so the caller (dialog) can stay open; a toast
   * is shown for surfaced errors.
   */
  async addTask(input: { taskListId: string; title: string; due?: string }): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // Offline add is out of scope: do NOT enqueue; just tell the user.
      this.showToast("Can't add a task while offline.");
      throw new Error('offline');
    }
    try {
      await this.api.insert(input.taskListId, {
        title: input.title,
        ...(input.due != null ? { due: input.due } : {}),
      });
      await this.refresh();
    } catch (err) {
      if (err instanceof SilentRenewFailedError) {
        this.patch({ screen: 'connect', connectError: false });
        throw err;
      }
      this.showToast('Could not add the task. Try again.');
      throw err;
    }
  }

  /**
   * Apply the Edit screen's changes to a task, then re-fetch so the list reflects
   * them. Not optimistic: the Edit screen is a separate full-viewport screen, so
   * there is no in-list card to animate; the underlying list simply updates on
   * the follow-up refresh.
   *
   * Order — patch scalar fields FIRST, then move (task id is preserved across a
   * move, so the move still targets the same task). A move is the only operation
   * Google rejects for recurring tasks; because the field patches already
   * succeeded by then, a recurring-move rejection is treated as a PARTIAL
   * success: we keep the applied title/notes/due changes and only tell the user
   * the move could not happen (rolling those patches back would need a second
   * round-trip and risks its own failure). Clearing the due date reuses the
   * dedicated {@link ApiLike.clearDue} (PATCH due:null).
   *
   * Offline editing is out of scope (like add/someday): we toast and do NOT
   * enqueue. Rejects on a hard failure so the Edit screen can stay open; a
   * recurring-move rejection resolves (the field changes stuck) so the screen
   * closes back to the list.
   */
  async updateTask(original: Task, changes: TaskUpdateChanges): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // Offline edit is out of scope: do NOT enqueue; just tell the user.
      this.showToast("Can't save changes while offline");
      throw new Error('offline');
    }
    const movingList = changes.listId != null && changes.listId !== original.taskListId;
    const destTitle = movingList
      ? this._state.lists.find((l) => l.id === changes.listId)?.title
      : undefined;
    try {
      // 1. Patch the scalar fields (title/notes and a date being SET) together.
      const patch: { title?: string; notes?: string; due?: string } = {};
      if (changes.title !== undefined) patch.title = changes.title;
      if (changes.notes !== undefined) patch.notes = changes.notes;
      if (typeof changes.due === 'string') patch.due = changes.due;
      if (Object.keys(patch).length > 0) {
        await this.api.updateTask(original.taskListId, original.id, patch);
      }
      // 2. Clearing the due date is a distinct PATCH due:null (reuse clearDue).
      if (changes.due === null) {
        await this.api.clearDue(original.taskListId, original.id);
      }
      // 3. Move last, only when the list actually changed.
      if (movingList && changes.listId) {
        await this.api.move(original.taskListId, original.id, changes.listId, destTitle);
      }
      await this.refresh();
    } catch (err) {
      if (err instanceof SilentRenewFailedError) {
        this.patch({ screen: 'connect', connectError: false });
        throw err;
      }
      if (movingList && isRecurringMoveError(err)) {
        // Field changes already persisted; keep them and surface only the move
        // failure. Refresh so the list shows the applied changes, then resolve.
        this.showToast("Recurring tasks can't be moved to another list.");
        await this.refresh();
        return;
      }
      this.showToast('Could not save changes. Try again.');
      throw err;
    }
  }

  /**
   * Delete a task. Optimistically removes it from the fetched set (the Edit
   * screen closes back to the list, where it should already be gone), then calls
   * the API and refreshes. On a real online failure the task is restored and a
   * toast shown. Offline delete is out of scope: we toast and do NOT enqueue.
   * Rejects on failure so the Edit screen can stay open.
   */
  async deleteTask(task: Task): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // Offline delete is out of scope: do NOT enqueue; just tell the user.
      this.showToast("Can't delete the task while offline");
      throw new Error('offline');
    }
    const removed = this.removeTask(task.id);
    try {
      await this.api.deleteTask(task.taskListId, task.id);
      await this.refresh();
    } catch (err) {
      if (err instanceof SilentRenewFailedError) {
        if (removed) this.restoreTask(removed);
        this.patch({ screen: 'connect', connectError: false });
        throw err;
      }
      if (removed) this.restoreTask(removed);
      this.showToast('Could not delete the task. Try again.');
      throw err;
    }
  }

  private async handleMutationFailure(
    err: unknown,
    removed: RemovedTask | null,
    mutation: Parameters<typeof enqueueMutation>[0],
  ): Promise<void> {
    if (err instanceof SilentRenewFailedError) {
      this.patch({ screen: 'connect', connectError: false });
      return;
    }
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (offline) {
      // Keep the optimistic removal; queue the mutation for later drain.
      await enqueueMutation(mutation);
      this.showToast('Offline — change queued.');
      return;
    }
    // Real online error: roll the card back in and warn.
    if (removed) this.restoreTask(removed);
    this.showToast('Something went wrong. Try again.');
  }

  /** Remove a task from the fetched set; return where it was for rollback. */
  private removeTask(taskId: string): RemovedTask | null {
    const idx = this._state.allTasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return null;
    const next = [...this._state.allTasks];
    const [task] = next.splice(idx, 1);
    this.setTasks(next);
    return { task, index: idx };
  }

  private restoreTask(removed: RemovedTask): void {
    const next = [...this._state.allTasks];
    next.splice(removed.index, 0, removed.task);
    this.setTasks(next);
  }

  /** Set the fetched task set and keep the three derived views in sync. */
  private setTasks(tasks: Task[]): void {
    const { now, scheduled, someday } = partitionViews(
      tasks,
      this._state.somedayListId,
    );
    this.patch({ allTasks: tasks, grouped: now, scheduled, someday });
  }

  // --- refresh triggers ----------------------------------------------------

  /** A silent re-fetch (no loading screen flip); used after mutations & focus. */
  async refresh(): Promise<void> {
    if (this._state.screen === 'connect') return;
    await this.load();
  }

  private wireRefreshTriggers(): void {
    if (this.listenersWired || typeof window === 'undefined') return;
    this.listenersWired = true;

    window.addEventListener('focus', () => void this.refresh());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.refresh();
    });
    window.addEventListener('online', () => void this.handleOnline());
    window.addEventListener('offline', () => this.patch({ offline: true }));
  }

  private async handleOnline(): Promise<void> {
    this.patch({ offline: false });
    try {
      await drainQueue(this.api as TasksApi);
    } catch (err) {
      if (err instanceof SilentRenewFailedError) {
        this.patch({ screen: 'connect', connectError: false });
        return;
      }
      // Leave remaining mutations queued; a later online/refresh retries them.
    }
    await this.refresh();
  }

  // --- settings ------------------------------------------------------------

  async setTheme(theme: ThemeName): Promise<void> {
    this.applyTheme(theme);
    this.patch({ theme });
    await setConfig({ theme });
  }

  /** Switch the display view and persist the choice. */
  async setView(view: ViewName): Promise<void> {
    if (this._state.view === view) return;
    this.patch({ view });
    await setConfig({ view });
  }

  /**
   * Choose (or clear) the designated Someday list, persist it, and re-partition
   * the current task set so the change is reflected immediately. A null id (or
   * one for a list that no longer exists) means "no Someday list".
   */
  async setSomedayList(listId: string | null): Promise<void> {
    await setConfig({ somedayListId: listId });
    this.patch({ somedayListId: listId });
    // Re-derive the three views from the already-fetched set under the new
    // Someday list, then refresh in the background for good measure.
    this.setTasks(this._state.allTasks);
    await this.refresh();
  }

  openSettings(): void {
    this.patch({ screen: 'settings' });
  }

  closeSettings(): void {
    this.patch({ screen: 'list' });
  }

  private applyTheme(theme: ThemeName): void {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  // --- toast ---------------------------------------------------------------

  showToast(message: string): void {
    this.patch({ toast: message });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.patch({ toast: null }), 3200);
  }

  dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.patch({ toast: null });
  }
}
