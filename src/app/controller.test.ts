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
    updateTask: vi.fn(
      async (
        _l: string,
        id: string,
        changes: { title?: string; notes?: string; due?: string },
      ) => {
        const t = store.find((x) => x.id === id);
        if (t) {
          if (changes.title !== undefined) t.title = changes.title;
          if (changes.notes !== undefined) t.notes = changes.notes;
          if (changes.due !== undefined) t.due = changes.due;
        }
        return { ...(t as Task) };
      },
    ),
    deleteTask: vi.fn(async (_l: string, id: string) => {
      const i = store.findIndex((x) => x.id === id);
      if (i >= 0) store.splice(i, 1);
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

/** A promise plus its resolve handle, to hold an API call pending mid-mutation. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

describe('AppController.updateTask', () => {
  it('patches changed fields (title/notes/due) and refetches', async () => {
    const api = makeApi([task('a', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    await ctrl.updateTask(a, { title: 'Renamed', notes: 'hello', due: localDate(2) });

    expect(api.updateTask).toHaveBeenCalledWith('l1', 'a', {
      title: 'Renamed',
      notes: 'hello',
      due: localDate(2),
    });
    // clearDue is NOT used when a real date is set.
    expect(api.clearDue).not.toHaveBeenCalled();
    // load + the refresh after the update.
    expect(api.listTasks).toHaveBeenCalledTimes(2);
    expect(ctrl.state.allTasks.find((t) => t.id === 'a')?.title).toBe('Renamed');
  });

  it('clears the due date via clearDue when due is set to none (null)', async () => {
    const api = makeApi([task('a', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    await ctrl.updateTask(a, { due: null });

    expect(api.clearDue).toHaveBeenCalledWith('l1', 'a');
    // A null due must NOT be forwarded to updateTask as a field patch.
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(ctrl.state.allTasks.find((t) => t.id === 'a')?.due).toBeNull();
  });

  it('moves the task when the list changes (patch first, then move)', async () => {
    const api = makeApi([task('a', localDate(0))]);
    // Two lists so a destination title can be resolved.
    api.listTaskLists = vi.fn(async () => [
      { id: 'l1', title: 'My Tasks' },
      { id: 'l2', title: 'Work' },
    ]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    await ctrl.updateTask(a, { title: 'Moved', listId: 'l2' });

    expect(api.updateTask).toHaveBeenCalledWith('l1', 'a', { title: 'Moved' });
    expect(api.move).toHaveBeenCalledWith('l1', 'a', 'l2', 'Work');
    // Field patch happened before the move.
    const updateOrder = (api.updateTask as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const moveOrder = (api.move as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(moveOrder);
  });

  it('does not move when the selected list is unchanged', async () => {
    const api = makeApi([task('a', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    await ctrl.updateTask(a, { title: 'Same list', listId: 'l1' });

    expect(api.move).not.toHaveBeenCalled();
  });

  it('rejects with a toast and does not patch when offline', async () => {
    const api = makeApi([task('a', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    setOnline(false);
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    await expect(ctrl.updateTask(a, { title: 'Nope' })).rejects.toThrow();

    expect(api.updateTask).not.toHaveBeenCalled();
    expect(ctrl.state.toast).toBe("Can't save changes while offline");
    expect(await listMutations()).toHaveLength(0);
  });

  it('keeps field changes but toasts when a recurring task cannot be moved', async () => {
    const api = makeApi([task('a', localDate(0))]);
    api.listTaskLists = vi.fn(async () => [
      { id: 'l1', title: 'My Tasks' },
      { id: 'l2', title: 'Work' },
    ]);
    api.move = vi.fn(async () => {
      throw new Error('Google Tasks API 400 Bad Request: cannot move recurring task');
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    // Resolves (partial success) rather than throwing, so the screen can close.
    await ctrl.updateTask(a, { title: 'Renamed', listId: 'l2' });

    expect(api.updateTask).toHaveBeenCalledWith('l1', 'a', { title: 'Renamed' });
    expect(ctrl.state.toast).toMatch(/recurring/i);
    // The field change stuck (applied before the rejected move).
    expect(ctrl.state.allTasks.find((t) => t.id === 'a')?.title).toBe('Renamed');
  });
});

describe('AppController.deleteTask', () => {
  it('optimistically removes the task and calls the API', async () => {
    const api = makeApi([task('a', localDate(0)), task('b', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    await ctrl.deleteTask(a);

    expect(api.deleteTask).toHaveBeenCalledWith('l1', 'a');
    expect(ctrl.state.grouped.today.map((t) => t.id)).toEqual(['b']);
  });

  it('rolls the task back and toasts on a real online error', async () => {
    const api = makeApi([task('a', localDate(0))]);
    api.deleteTask = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    await expect(ctrl.deleteTask(a)).rejects.toThrow();

    expect(ctrl.state.grouped.today.map((t) => t.id)).toEqual(['a']);
    expect(ctrl.state.toast).toBeTruthy();
  });

  it('rejects with a toast and does not remove when offline', async () => {
    const api = makeApi([task('a', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    setOnline(false);
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    await expect(ctrl.deleteTask(a)).rejects.toThrow();

    expect(api.deleteTask).not.toHaveBeenCalled();
    expect(ctrl.state.toast).toBe("Can't delete the task while offline");
    expect(ctrl.state.grouped.today.map((t) => t.id)).toEqual(['a']);
    expect(await listMutations()).toHaveLength(0);
  });
});

describe('AppController.moveToNow', () => {
  it('clears the due date via the API and refetches (scheduled task → Now)', async () => {
    const api = makeApi([task('a', localDate(3))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    // The future task starts in the Scheduled view, not Now.
    expect(ctrl.state.scheduled.map((t) => t.id)).toEqual(['a']);
    const a = ctrl.state.scheduled.find((t) => t.id === 'a')!;

    await ctrl.moveToNow(a);

    expect(api.clearDue).toHaveBeenCalledWith('l1', 'a');
    // Not in the Someday list, so no move.
    expect(api.move).not.toHaveBeenCalled();
    // load + the refresh after clearing.
    expect(api.listTasks).toHaveBeenCalledTimes(2);
    // Now dateless, the task lands in Now's noDate group and leaves Scheduled.
    expect(ctrl.state.scheduled).toEqual([]);
    expect(ctrl.state.grouped.noDate.map((t) => t.id)).toEqual(['a']);
    expect(ctrl.state.allTasks.find((t) => t.id === 'a')?.due).toBeNull();
  });

  it('ejects a Someday-list task to the default list, landing it in Now (optimistically)', async () => {
    // Two lists: l1 is the default (Now) list, l2 is the Someday list. A dateless
    // task parked in l2 is in the Someday view; picking "Now" moves it to l1.
    const lists = [
      { id: 'l1', title: 'My Tasks' },
      { id: 'l2', title: 'Someday' },
    ];
    const store: Task[] = [
      {
        id: 't',
        taskListId: 'l2',
        taskListTitle: 'Someday',
        title: 'Task t',
        due: null,
        status: 'needsAction',
        position: '',
      },
    ];
    const gate = deferred();
    const api: ApiLike = {
      listTaskLists: vi.fn(async () => lists.map((l) => ({ ...l }))),
      listTasks: vi.fn(async (listId: string) =>
        store.filter((t) => t.taskListId === listId).map((t) => ({ ...t })),
      ),
      insert: vi.fn(),
      patchDue: vi.fn(),
      complete: vi.fn(),
      clearDue: vi.fn(async (_l: string, id: string) => {
        const t = store.find((x) => x.id === id);
        if (t) t.due = null;
      }),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      move: vi.fn(async (_l: string, id: string, dest: string, destTitle?: string) => {
        const t = store.find((x) => x.id === id)!;
        t.taskListId = dest;
        t.taskListTitle = destTitle ?? '';
        await gate.promise; // hold refetch pending to prove optimism
        return { ...t };
      }),
    };
    await setConfig({ somedayListId: 'l2' });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.boot();
    // Starts parked in the Someday view.
    expect(ctrl.state.someday.map((t) => t.id)).toEqual(['t']);
    const t = ctrl.state.someday.find((x) => x.id === 't')!;

    const p = ctrl.moveToNow(t);
    // Re-partitioned into Now instantly, before the move/refetch resolves.
    expect(ctrl.state.someday).toEqual([]);
    expect(ctrl.state.grouped.noDate.map((x) => x.id)).toEqual(['t']);

    gate.resolve();
    await p;

    expect(api.move).toHaveBeenCalledWith('l2', 't', 'l1', 'My Tasks');
    // After reconcile it remains dateless in the default list → Now.
    expect(ctrl.state.someday).toEqual([]);
    expect(ctrl.state.grouped.noDate.map((x) => x.id)).toEqual(['t']);
    expect(ctrl.state.allTasks.find((x) => x.id === 't')?.taskListId).toBe('l1');
  });

  it('toasts and does NOT clear or enqueue when offline', async () => {
    const api = makeApi([task('a', localDate(3))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    setOnline(false);
    const a = ctrl.state.scheduled.find((t) => t.id === 'a')!;

    await ctrl.moveToNow(a);

    expect(api.clearDue).not.toHaveBeenCalled();
    expect(api.move).not.toHaveBeenCalled();
    expect(ctrl.state.toast).toBe("Can't do that while offline");
    expect(await listMutations()).toHaveLength(0);
    // The task is untouched (no optimistic change offline).
    expect(ctrl.state.scheduled.map((t) => t.id)).toEqual(['a']);
  });

  it('rolls the task back in and toasts on a real online error', async () => {
    const api = makeApi([task('a', localDate(3))]);
    api.clearDue = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.scheduled.find((t) => t.id === 'a')!;

    await ctrl.moveToNow(a);

    // Restored to its original view; a toast is shown; nothing queued.
    expect(ctrl.state.scheduled.map((t) => t.id)).toEqual(['a']);
    expect(ctrl.state.toast).toBeTruthy();
    expect(await listMutations()).toHaveLength(0);
  });

  it('toasts when the due date is silently NOT cleared (Google ignores a recurring move)', async () => {
    const api = makeApi([task('a', localDate(3))]);
    // Google returns success but silently ignores clearing a recurring task's
    // due date: nothing throws, yet the date survives the refetch.
    api.clearDue = vi.fn(async () => {
      /* silently ignored */
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.scheduled.find((t) => t.id === 'a')!;

    await ctrl.moveToNow(a);

    // Post-refresh the task still has its due date, so the move didn't take.
    expect(ctrl.state.allTasks.find((t) => t.id === 'a')?.due).toBe(localDate(3));
    expect(ctrl.state.toast).toBe("Recurring tasks can't be moved.");
  });

  it('does NOT toast on the happy path (due date cleared, task reaches Now)', async () => {
    const api = makeApi([task('a', localDate(3))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.scheduled.find((t) => t.id === 'a')!;

    await ctrl.moveToNow(a);

    expect(ctrl.state.grouped.noDate.map((t) => t.id)).toEqual(['a']);
    expect(ctrl.state.toast).toBeNull();
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

  it('shows the generic message on a non-recurrence move failure', async () => {
    await setConfig({ somedayListId: 'l1' });
    const api = makeApi([task('t', localDate(0))]);
    api.move = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.boot();
    const t = ctrl.state.grouped.today.find((x) => x.id === 't')!;

    await ctrl.moveToSomeday(t);

    expect(ctrl.state.toast).toBe("Couldn't move to Someday.");
  });

  it('treats Google\'s "repeating" wording as a recurrence error', async () => {
    await setConfig({ somedayListId: 'l1' });
    const api = makeApi([task('t', localDate(0))]);
    api.move = vi.fn(async () => {
      throw new Error('Google Tasks API 400 Bad Request: cannot move a repeating task');
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.boot();
    const t = ctrl.state.grouped.today.find((x) => x.id === 't')!;

    await ctrl.moveToSomeday(t);

    expect(ctrl.state.toast).toBe("Recurring tasks can't be moved to Someday.");
  });

  it('toasts when the move is silently ignored by Google (post-refresh still not in Someday)', async () => {
    // Someday is a SEPARATE list (l2); the task lives in l1. Google returns
    // success for moving/clearing a recurring task but silently ignores it, so
    // nothing throws — yet the refetch shows the task never left l1.
    await setConfig({ somedayListId: 'l2' });
    const lists = [
      { id: 'l1', title: 'My Tasks' },
      { id: 'l2', title: 'Someday' },
    ];
    const store: Task[] = [
      {
        id: 't',
        taskListId: 'l1',
        taskListTitle: 'My Tasks',
        title: 'Task t',
        due: localDate(0),
        status: 'needsAction',
        position: '',
      },
    ];
    const api: ApiLike = {
      listTaskLists: vi.fn(async () => lists.map((l) => ({ ...l }))),
      listTasks: vi.fn(async (listId: string) =>
        store.filter((t) => t.taskListId === listId).map((t) => ({ ...t })),
      ),
      insert: vi.fn(),
      patchDue: vi.fn(),
      complete: vi.fn(),
      // Both silently ignored (recurring task): return success, change nothing.
      clearDue: vi.fn(async () => {}),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      move: vi.fn(async () => ({ ...store[0] })),
    };
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.boot();
    const t = ctrl.state.grouped.today.find((x) => x.id === 't')!;

    await ctrl.moveToSomeday(t);

    // Never reached Someday; the silent no-op is surfaced.
    expect(ctrl.state.someday).toEqual([]);
    expect(ctrl.state.allTasks.find((x) => x.id === 't')?.taskListId).toBe('l1');
    expect(ctrl.state.toast).toBe("Recurring tasks can't be moved to Someday.");
  });

  it('does NOT toast on the happy path (task reaches the Someday list, dateless)', async () => {
    await setConfig({ somedayListId: 'l1' });
    const api = makeApi([task('t', localDate(0))]);
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.boot();
    const t = ctrl.state.grouped.today.find((x) => x.id === 't')!;

    await ctrl.moveToSomeday(t);

    expect(ctrl.state.someday.map((x) => x.id)).toEqual(['t']);
    expect(ctrl.state.toast).toBeNull();
  });
});

describe('optimistic in-place cross-view moves (re-partition before refetch)', () => {
  it('snooze moves the task into Scheduled instantly, before the refetch resolves', async () => {
    const api = makeApi([task('a', localDate(-1))]); // overdue → Now
    const gate = deferred();
    api.patchDue = vi.fn(async (_l: string, id: string, due: string) => {
      const t = api.store.find((x) => x.id === id);
      if (t) t.due = due;
      await gate.promise; // hold the API (and thus the refetch) pending
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.overdue.find((t) => t.id === 'a')!;

    const p = ctrl.snoozeTask(a, localDate(3));
    // Present in the NEW view's partition immediately (no refetch yet).
    expect(ctrl.state.grouped.overdue).toEqual([]);
    expect(ctrl.state.scheduled.map((t) => t.id)).toEqual(['a']);

    gate.resolve();
    await p;
    // The reconciling refetch keeps it in Scheduled.
    expect(ctrl.state.scheduled.map((t) => t.id)).toEqual(['a']);
  });

  it('snooze reverts the task to its original view on an online failure', async () => {
    const api = makeApi([task('a', localDate(-1))]); // overdue → Now
    api.patchDue = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.overdue.find((t) => t.id === 'a')!;

    await ctrl.snoozeTask(a, localDate(3));

    expect(ctrl.state.grouped.overdue.map((t) => t.id)).toEqual(['a']);
    expect(ctrl.state.scheduled).toEqual([]);
    expect(ctrl.state.toast).toBeTruthy();
    expect(await listMutations()).toHaveLength(0);
  });

  it('moveToNow moves the task into Now instantly, before the refetch resolves', async () => {
    const api = makeApi([task('a', localDate(3))]); // future → Scheduled
    const gate = deferred();
    api.clearDue = vi.fn(async (_l: string, id: string) => {
      const t = api.store.find((x) => x.id === id);
      if (t) t.due = null;
      await gate.promise;
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.scheduled.find((t) => t.id === 'a')!;

    const p = ctrl.moveToNow(a);
    expect(ctrl.state.scheduled).toEqual([]);
    expect(ctrl.state.grouped.noDate.map((t) => t.id)).toEqual(['a']);

    gate.resolve();
    await p;
    expect(ctrl.state.grouped.noDate.map((t) => t.id)).toEqual(['a']);
  });

  it('moveToSomeday moves the task into Someday instantly, before the refetch resolves', async () => {
    await setConfig({ somedayListId: 'l1' });
    const api = makeApi([task('t', localDate(0))]); // today → Now
    const gate = deferred();
    api.move = vi.fn(
      async (_l: string, id: string, dest: string, destTitle?: string) => {
        const t = api.store.find((x) => x.id === id)!;
        t.taskListId = dest;
        t.taskListTitle = destTitle ?? '';
        t.due = null; // move+clear reflected server-side
        await gate.promise;
        return { ...t };
      },
    );
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.boot();
    const t = ctrl.state.grouped.today.find((x) => x.id === 't')!;

    const p = ctrl.moveToSomeday(t);
    expect(ctrl.state.grouped.today).toEqual([]);
    expect(ctrl.state.someday.map((x) => x.id)).toEqual(['t']);

    gate.resolve();
    await p;
    expect(ctrl.state.someday.map((x) => x.id)).toEqual(['t']);
  });

  it('updateTask (edit) re-partitions in place instantly, before the refetch resolves', async () => {
    const api = makeApi([task('a', localDate(0))]); // today → Now
    const gate = deferred();
    api.updateTask = vi.fn(
      async (_l: string, id: string, changes: { title?: string; due?: string }) => {
        const t = api.store.find((x) => x.id === id)!;
        if (changes.title !== undefined) t.title = changes.title;
        if (changes.due !== undefined) t.due = changes.due;
        await gate.promise;
        return { ...t };
      },
    );
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    const p = ctrl.updateTask(a, { due: localDate(5) });
    expect(ctrl.state.grouped.today).toEqual([]);
    expect(ctrl.state.scheduled.map((t) => t.id)).toEqual(['a']);

    gate.resolve();
    await p;
    expect(ctrl.state.scheduled.map((t) => t.id)).toEqual(['a']);
  });

  it('updateTask reverts the optimistic change on a hard failure', async () => {
    const api = makeApi([task('a', localDate(0))]); // today → Now
    api.updateTask = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctrl = new AppController({ auth: makeAuth(), api });
    await ctrl.load();
    const a = ctrl.state.grouped.today.find((t) => t.id === 'a')!;

    await expect(ctrl.updateTask(a, { title: 'Renamed', due: localDate(5) })).rejects.toThrow();

    // Reverted to the original view and title; nothing leaked into Scheduled.
    expect(ctrl.state.scheduled).toEqual([]);
    expect(ctrl.state.grouped.today.map((t) => t.id)).toEqual(['a']);
    expect(ctrl.state.allTasks.find((t) => t.id === 'a')?.title).toBe('Task a');
    expect(ctrl.state.toast).toBeTruthy();
  });
});
