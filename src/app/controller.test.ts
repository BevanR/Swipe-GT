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
    position: '',
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
    insert: vi.fn(async (listId: string, input: { title: string; due?: string }) => {
      const created: Task = {
        id: `new-${store.length + 1}`,
        taskListId: listId,
        taskListTitle: 'My Tasks',
        title: input.title,
        due: input.due ?? null,
        status: 'needsAction',
        position: '',
      };
      store.push(created);
      return { ...created };
    }),
    complete: vi.fn(async (_l: string, id: string) => {
      const i = store.findIndex((t) => t.id === id);
      if (i >= 0) store.splice(i, 1);
    }),
    patchDue: vi.fn(async (_l: string, id: string, due: string) => {
      const t = store.find((x) => x.id === id);
      if (t) t.due = due;
    }),
    clearDue: vi.fn(async (_l: string, id: string) => {
      const t = store.find((x) => x.id === id);
      if (t) t.due = null;
    }),
    move: vi.fn(async (_l: string, id: string, dest: string, destTitle?: string) => {
      const t = store.find((x) => x.id === id);
      if (t) {
        t.taskListId = dest;
        t.taskListTitle = destTitle ?? '';
      }
      return { ...(t as Task) };
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

  it('exposes all fetched lists (no inclusion filtering)', async () => {
    const api = makeApi([task('today', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    expect(ctrl.state.lists).toEqual([{ id: 'l1', title: 'My Tasks' }]);
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

describe('AppController.addTask', () => {
  it('inserts the task then refetches so it appears in the right view', async () => {
    const api = makeApi([task('a', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    expect(api.listTasks).toHaveBeenCalledTimes(1);

    await ctrl.addTask({ taskListId: 'l1', title: 'Buy milk' });

    expect(api.insert).toHaveBeenCalledWith('l1', { title: 'Buy milk' });
    // load + the refresh after insert.
    expect(api.listTasks).toHaveBeenCalledTimes(2);
    // No due date → shows in the no-date group of the default view.
    expect(ctrl.state.grouped.noDate.map((t) => t.title)).toContain('Buy milk');
  });

  it('passes a due date through to insert (future task lands in allTasks)', async () => {
    const api = makeApi([]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();

    await ctrl.addTask({ taskListId: 'l1', title: 'Offsite', due: localDate(30) });

    expect(api.insert).toHaveBeenCalledWith('l1', { title: 'Offsite', due: localDate(30) });
    expect(ctrl.state.allTasks.map((t) => t.title)).toContain('Offsite');
  });

  it('surfaces an error and does not enqueue when offline', async () => {
    const api = makeApi([]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    setOnline(false);

    await expect(ctrl.addTask({ taskListId: 'l1', title: 'Nope' })).rejects.toThrow();

    expect(api.insert).not.toHaveBeenCalled();
    expect(ctrl.state.toast).toBeTruthy();
    expect(await listMutations()).toHaveLength(0);
  });

  it('rejects and toasts on a real online error', async () => {
    const api = makeApi([]);
    api.insert = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();

    await expect(ctrl.addTask({ taskListId: 'l1', title: 'Nope' })).rejects.toThrow();
    expect(ctrl.state.toast).toBeTruthy();
    expect(await listMutations()).toHaveLength(0);
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

  it('restores the persisted view from config', async () => {
    await setConfig({ view: 'scheduled' });
    const auth = makeAuth();
    auth.isConnected = vi.fn(async () => false);
    const ctrl = new AppController({ auth, api: makeApi([]) });
    await ctrl.boot();
    expect(ctrl.state.view).toBe('scheduled');
  });

  it('migrates a legacy persisted view (future → scheduled) on boot', async () => {
    await setConfig({ view: 'future' as unknown as 'scheduled' });
    const auth = makeAuth();
    auth.isConnected = vi.fn(async () => false);
    const ctrl = new AppController({ auth, api: makeApi([]) });
    await ctrl.boot();
    expect(ctrl.state.view).toBe('scheduled');
  });

  it('falls back to the "now" view when a stale/unknown view is persisted', async () => {
    // Simulate an old build that persisted the removed 'starred' view.
    await setConfig({ view: 'starred' as unknown as 'now' });
    const auth = makeAuth();
    auth.isConnected = vi.fn(async () => false);
    const ctrl = new AppController({ auth, api: makeApi([]) });
    await ctrl.boot();
    expect(ctrl.state.view).toBe('now');
  });

  it('restores the persisted somedayListId on boot', async () => {
    await setConfig({ somedayListId: 'l1' });
    const auth = makeAuth();
    auth.isConnected = vi.fn(async () => false);
    const ctrl = new AppController({ auth, api: makeApi([]) });
    await ctrl.boot();
    expect(ctrl.state.somedayListId).toBe('l1');
  });
});

describe('AppController.setView', () => {
  it('switches and persists the view; keeps allTasks + derived views', async () => {
    const api = makeApi([
      task('overdue', localDate(-1)),
      task('today', localDate(0)),
      task('future', localDate(3)),
    ]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();

    // The full fetched set is retained; the future task lands in `scheduled`.
    expect(ctrl.state.allTasks.map((t) => t.id).sort()).toEqual([
      'future',
      'overdue',
      'today',
    ]);
    expect(ctrl.state.grouped.overdue.map((t) => t.id)).toEqual(['overdue']);
    expect(ctrl.state.scheduled.map((t) => t.id)).toEqual(['future']);

    await ctrl.setView('scheduled');
    expect(ctrl.state.view).toBe('scheduled');
    expect((await getConfig()).view).toBe('scheduled');
  });
});

describe('AppController.setSomedayList', () => {
  it('re-partitions so dateless someday-list tasks move to the someday view', async () => {
    const api = makeApi([task('parked', null), task('today', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();

    // Before choosing a someday list, the dateless task is in Now's noDate.
    expect(ctrl.state.grouped.noDate.map((t) => t.id)).toEqual(['parked']);
    expect(ctrl.state.someday).toEqual([]);

    await ctrl.setSomedayList('l1');

    expect(ctrl.state.somedayListId).toBe('l1');
    expect((await getConfig()).somedayListId).toBe('l1');
    // The dateless l1 task is now in the someday view, out of Now.
    expect(ctrl.state.someday.map((t) => t.id)).toEqual(['parked']);
    expect(ctrl.state.grouped.noDate).toEqual([]);
    // The dated task stays in Now regardless of its list.
    expect(ctrl.state.grouped.today.map((t) => t.id)).toEqual(['today']);
  });

  it('clearing the someday list (null) returns dateless tasks to Now', async () => {
    await setConfig({ somedayListId: 'l1' });
    const api = makeApi([task('parked', null)]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.boot();
    expect(ctrl.state.someday.map((t) => t.id)).toEqual(['parked']);

    await ctrl.setSomedayList(null);
    expect(ctrl.state.somedayListId).toBeNull();
    expect(ctrl.state.someday).toEqual([]);
    expect(ctrl.state.grouped.noDate.map((t) => t.id)).toEqual(['parked']);
  });
});

describe('AppController.moveToSomeday', () => {
  it('clears the due date and moves the task, landing it in the someday view', async () => {
    await setConfig({ somedayListId: 'l1' });
    const api = makeApi([task('t', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.boot();
    const t = ctrl.state.grouped.today.find((x) => x.id === 't')!;

    await ctrl.moveToSomeday(t);

    expect(api.move).toHaveBeenCalledWith('l1', 't', 'l1', 'My Tasks');
    expect(api.clearDue).toHaveBeenCalledWith('l1', 't');
    // After refetch the task is dateless in the someday list → someday view.
    expect(ctrl.state.someday.map((x) => x.id)).toEqual(['t']);
    expect(ctrl.state.grouped.today).toEqual([]);
  });

  it('toasts and does not move when no someday list is configured', async () => {
    const api = makeApi([task('t', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const t = ctrl.state.grouped.today.find((x) => x.id === 't')!;

    await ctrl.moveToSomeday(t);

    expect(api.move).not.toHaveBeenCalled();
    expect(ctrl.state.toast).toBeTruthy();
    // Task stays put.
    expect(ctrl.state.grouped.today.map((x) => x.id)).toEqual(['t']);
  });

  it('rejects with a toast when offline and does not enqueue', async () => {
    await setConfig({ somedayListId: 'l1' });
    const api = makeApi([task('t', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.boot();
    setOnline(false);
    const t = ctrl.state.grouped.today.find((x) => x.id === 't')!;

    await ctrl.moveToSomeday(t);

    expect(api.move).not.toHaveBeenCalled();
    expect(ctrl.state.toast).toBe("Can't move to Someday while offline");
    expect(await listMutations()).toHaveLength(0);
    // Optimistic removal is not applied (the task is still in Now).
    expect(ctrl.state.grouped.today.map((x) => x.id)).toEqual(['t']);
  });

  it('rolls back and shows a clear message when the task is recurring', async () => {
    await setConfig({ somedayListId: 'l1' });
    const api = makeApi([task('t', localDate(0))]);
    api.move = vi.fn(async () => {
      throw new Error('Google Tasks API 400 Bad Request: cannot move recurring task');
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.boot();
    const t = ctrl.state.grouped.today.find((x) => x.id === 't')!;

    await ctrl.moveToSomeday(t);

    expect(ctrl.state.grouped.today.map((x) => x.id)).toEqual(['t']);
    expect(ctrl.state.toast).toMatch(/recurring/i);
    expect(await listMutations()).toHaveLength(0);
  });

  it('rolls back and toasts on any other move error', async () => {
    await setConfig({ somedayListId: 'l1' });
    const api = makeApi([task('t', localDate(0))]);
    api.move = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.boot();
    const t = ctrl.state.grouped.today.find((x) => x.id === 't')!;

    await ctrl.moveToSomeday(t);

    expect(ctrl.state.grouped.today.map((x) => x.id)).toEqual(['t']);
    expect(ctrl.state.toast).toBeTruthy();
    expect(ctrl.state.toast).not.toMatch(/recurring/i);
    expect(await listMutations()).toHaveLength(0);
  });
});
