import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController, type ApiLike, type AuthLike } from './controller';
import { _resetDbForTests, getConfig, listMutations, setConfig } from '../storage/db';
import type { Task } from '../types';

function localDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function task(id: string, due: string | null): Task {
  return {
    id,
    taskListId: 'l1',
    taskListTitle: 'My Tasks',
    title: `Task ${id}`,
    due,
    status: 'needsAction',
  };
}

function makeAuth(): AuthLike {
  return {
    connect: vi.fn(async () => ({})),
    getValidAccessToken: vi.fn(async () => 'tok'),
    isConnected: vi.fn(async () => true),
  };
}

function makeApi(initial: Task[]): ApiLike & { store: Task[] } {
  const store = initial.map((t) => ({ ...t }));
  return {
    store,
    listTaskLists: vi.fn(async () => [{ id: 'l1', title: 'My Tasks' }]),
    listTasks: vi.fn(async () => store.map((t) => ({ ...t }))),
    complete: vi.fn(async (_l: string, id: string) => {
      const i = store.findIndex((t) => t.id === id);
      if (i >= 0) store.splice(i, 1);
    }),
    patchDue: vi.fn(async (_l: string, id: string, due: string) => {
      const t = store.find((x) => x.id === id);
      if (t) t.due = due;
    }),
  };
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDbForTests();
  setOnline(true);
});

describe('AppController.load (filter → render wiring)', () => {
  it('fetches, filters, and groups tasks; lands on the list screen', async () => {
    const api = makeApi([
      task('overdue', localDate(-1)),
      task('today', localDate(0)),
      task('nodate', null),
      task('future', localDate(1)),
    ]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();

    expect(ctrl.state.screen).toBe('list');
    expect(ctrl.state.grouped.overdue.map((t) => t.id)).toEqual(['overdue']);
    expect(ctrl.state.grouped.today.map((t) => t.id)).toEqual(['today']);
    expect(ctrl.state.grouped.noDate.map((t) => t.id)).toEqual(['nodate']);
    // Future task is excluded entirely.
    const allShown = [
      ...ctrl.state.grouped.overdue,
      ...ctrl.state.grouped.today,
      ...ctrl.state.grouped.noDate,
    ];
    expect(allShown.find((t) => t.id === 'future')).toBeUndefined();
  });

  it('defaults new lists to included and persists them', async () => {
    const api = makeApi([task('today', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    expect(ctrl.state.lists).toEqual([{ id: 'l1', title: 'My Tasks', included: true }]);
  });
});

describe('AppController.completeTask (optimistic + rollback)', () => {
  it('removes the task optimistically and completes it online', async () => {
    const api = makeApi([task('a', localDate(0)), task('b', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    await ctrl.completeTask(a);

    expect(api.complete).toHaveBeenCalledWith('l1', 'a');
    // After the follow-up refresh, 'a' is gone and 'b' remains.
    expect(ctrl.state.grouped.today.map((t) => t.id)).toEqual(['b']);
  });

  it('rolls the card back in and toasts on a real online error', async () => {
    const api = makeApi([task('a', localDate(0))]);
    api.complete = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    await ctrl.completeTask(a);

    expect(ctrl.state.grouped.today.map((t) => t.id)).toEqual(['a']);
    expect(ctrl.state.toast).toBeTruthy();
    expect(await listMutations()).toHaveLength(0);
  });

  it('queues the mutation and keeps it removed when offline', async () => {
    const api = makeApi([task('a', localDate(0))]);
    api.complete = vi.fn(async () => {
      throw new Error('offline fetch failed');
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    setOnline(false);
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    await ctrl.completeTask(a);

    expect(ctrl.state.grouped.today).toHaveLength(0);
    const queued = await listMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ type: 'complete', taskId: 'a', taskListId: 'l1' });
  });
});

describe('AppController.snoozeTask', () => {
  it('patches the due date and re-filters (snoozed task drops out of overdue)', async () => {
    const api = makeApi([task('a', localDate(-1))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.overdue.find((t) => t.id === 'a')!;

    await ctrl.snoozeTask(a, localDate(3));

    expect(api.patchDue).toHaveBeenCalledWith('l1', 'a', localDate(3));
    expect(ctrl.state.grouped.overdue).toHaveLength(0);
  });
});

describe('AppController.boot', () => {
  it('shows the connect screen when not connected', async () => {
    const auth = makeAuth();
    auth.isConnected = vi.fn(async () => false);
    const ctrl = new AppController({ auth, api: makeApi([]) });
    await ctrl.boot();
    expect(ctrl.state.screen).toBe('connect');
  });

  it('restores the persisted view and starred ids from config', async () => {
    await setConfig({ view: 'future', starredTaskIds: ['x', 'y'] });
    const auth = makeAuth();
    auth.isConnected = vi.fn(async () => false);
    const ctrl = new AppController({ auth, api: makeApi([]) });
    await ctrl.boot();
    expect(ctrl.state.view).toBe('future');
    expect(ctrl.state.starredIds).toEqual(['x', 'y']);
  });
});

describe('AppController.toggleStar', () => {
  it('adds then removes a star and persists it', async () => {
    const ctrl = new AppController({ auth: makeAuth(), api: makeApi([]) });

    await ctrl.toggleStar('t1');
    expect(ctrl.state.starredIds).toEqual(['t1']);
    expect((await getConfig()).starredTaskIds).toEqual(['t1']);

    await ctrl.toggleStar('t1');
    expect(ctrl.state.starredIds).toEqual([]);
    expect((await getConfig()).starredTaskIds).toEqual([]);
  });
});

describe('AppController.setView', () => {
  it('switches and persists the view; keeps allTasks for filtering', async () => {
    const api = makeApi([
      task('overdue', localDate(-1)),
      task('today', localDate(0)),
      task('future', localDate(3)),
    ]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();

    // The full fetched set (incl. the future task) is retained for the
    // starred/future views, even though it is filtered out of `grouped`.
    expect(ctrl.state.allTasks.map((t) => t.id).sort()).toEqual([
      'future',
      'overdue',
      'today',
    ]);
    expect(ctrl.state.grouped.overdue.map((t) => t.id)).toEqual(['overdue']);

    await ctrl.setView('future');
    expect(ctrl.state.view).toBe('future');
    expect((await getConfig()).view).toBe('future');
  });
});
