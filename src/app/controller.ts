import { AuthClient, SilentRenewFailedError } from '../auth/authClient';
import { TasksApi } from '../api/tasksApi';
import {
  getConfig,
  getSnapshot,
  setConfig,
  setSnapshot,
} from '../storage/db';
import { drainQueue, enqueueMutation } from '../pwa/offlineQueue';
import { filterAndGroup } from '../logic/filter';
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
}

/** Remembers where a task lived so an online failure can roll it back in. */
interface RemovedTask {
  task: Task;
  index: number;
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
      allTasks: [],
      lists: [],
      fetchedAt: null,
      fromCache: false,
      connectError: false,
    });
  }

  // --- loading -------------------------------------------------------------

  /** Fetch lists + tasks, filter/group, cache, and render. */
  async load(): Promise<void> {
    this.patch({ loading: true });
    try {
      const rawLists = await this.api.listTaskLists();
      const lists = await this.reconcileInclusion(rawLists);

      const tasks: Task[] = [];
      for (const list of lists) {
        if (!list.included) continue;
        const listTasks = await this.api.listTasks(list.id, list.title);
        tasks.push(...listTasks);
      }

      const fetchedAt = Date.now();
      await setSnapshot({ fetchedAt, tasks, lists });

      this.patch({
        allTasks: tasks,
        grouped: filterAndGroup(tasks),
        lists,
        fetchedAt,
        fromCache: false,
        offline: false,
        loading: false,
      });
      // Only jump to the list screen from loading/connect; keep settings open
      // if the user is there (an inclusion change re-runs load in the background).
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
        allTasks: snapshot.tasks,
        grouped: filterAndGroup(snapshot.tasks),
        lists: snapshot.lists,
        fetchedAt: snapshot.fetchedAt,
        fromCache: true,
        offline: true,
        loading: false,
      });
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

  /**
   * For any list id not present in config.listInclusion, default it to included
   * and persist (never auto-exclude). Returns the TaskList[] with `included`.
   */
  private async reconcileInclusion(
    rawLists: { id: string; title: string }[],
  ): Promise<TaskList[]> {
    const cfg = await getConfig();
    const inclusion = { ...cfg.listInclusion };
    let changed = false;
    for (const l of rawLists) {
      if (!(l.id in inclusion)) {
        inclusion[l.id] = true;
        changed = true;
      }
    }
    if (changed) await setConfig({ listInclusion: inclusion });
    return rawLists.map((l) => ({
      id: l.id,
      title: l.title,
      included: inclusion[l.id] !== false,
    }));
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
   * Create a new task, then re-fetch so it lands in the correct view (default
   * if due today/overdue/none, Scheduled if future). Requires connectivity and
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

  /** Set the fetched task set and keep the derived grouping in sync. */
  private setTasks(tasks: Task[]): void {
    this.patch({ allTasks: tasks, grouped: filterAndGroup(tasks) });
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

  async setInclusion(listId: string, included: boolean): Promise<void> {
    const cfg = await getConfig();
    const inclusion = { ...cfg.listInclusion, [listId]: included };
    await setConfig({ listInclusion: inclusion });
    const lists = this._state.lists.map((l) =>
      l.id === listId ? { ...l, included } : l,
    );
    this.patch({ lists });
    await this.load();
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
