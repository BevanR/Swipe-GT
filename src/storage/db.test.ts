import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PendingMutation, Snapshot } from '../types';
import {
  DEFAULT_CONFIG,
  _resetDbForTests,
  deleteMutation,
  enqueueMutation,
  getConfig,
  getSnapshot,
  listMutations,
  setConfig,
  setSnapshot,
} from './db';

beforeEach(() => {
  // Fresh IndexedDB per test.
  globalThis.indexedDB = new IDBFactory();
  _resetDbForTests();
});

describe('config', () => {
  it('returns DEFAULT_CONFIG when nothing persisted', async () => {
    expect(await getConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('shallow-merges a patch over the stored config', async () => {
    await setConfig({ theme: 'tasks' });
    let cfg = await getConfig();
    expect(cfg.theme).toBe('tasks');
    expect(cfg.auth).toBeNull();

    await setConfig({ auth: { accessToken: 'abc', accessTokenExpiry: 123 } });
    cfg = await getConfig();
    // Prior patch is preserved, new patch merged in.
    expect(cfg.theme).toBe('tasks');
    expect(cfg.auth).toEqual({ accessToken: 'abc', accessTokenExpiry: 123 });
  });

  it('merges stored config over defaults for absent keys', async () => {
    await setConfig({ somedayListId: 'list-x' });
    const cfg = await getConfig();
    expect(cfg.somedayListId).toBe('list-x');
    expect(cfg.theme).toBe('tasks'); // default
  });
});

describe('config migration', () => {
  it('migrates a legacy view "default" → "now"', async () => {
    await setConfig({ view: 'default' as unknown as 'now' });
    expect((await getConfig()).view).toBe('now');
  });

  it('migrates a legacy view "future" → "scheduled"', async () => {
    await setConfig({ view: 'future' as unknown as 'now' });
    expect((await getConfig()).view).toBe('scheduled');
  });

  it('falls back to "now" for an unknown/stale view', async () => {
    await setConfig({ view: 'starred' as unknown as 'now' });
    expect((await getConfig()).view).toBe('now');
  });

  it('keeps a valid current view unchanged', async () => {
    await setConfig({ view: 'someday' });
    expect((await getConfig()).view).toBe('someday');
  });

  it('drops a legacy listInclusion field and defaults somedayListId to null', async () => {
    // Simulate an old build that persisted listInclusion (no longer in AppConfig).
    await setConfig({ listInclusion: { l1: false } } as unknown as Partial<
      Parameters<typeof setConfig>[0]
    >);
    const cfg = await getConfig();
    expect('listInclusion' in cfg).toBe(false);
    expect(cfg.somedayListId).toBeNull();
  });

  it('tolerates a somedayListId for a list that no longer exists', async () => {
    await setConfig({ somedayListId: 'gone' });
    // Read back verbatim; treating it as "none" happens at partition/render time.
    expect((await getConfig()).somedayListId).toBe('gone');
  });
});

describe('snapshot', () => {
  it('returns null when none stored', async () => {
    expect(await getSnapshot()).toBeNull();
  });

  it('round-trips a snapshot', async () => {
    const snap: Snapshot = {
      fetchedAt: 1000,
      tasks: [
        { id: 't1', taskListId: 'l1', taskListTitle: 'L1', title: 'A', due: null, status: 'needsAction', position: '' },
      ],
      lists: [{ id: 'l1', title: 'L1' }],
    };
    await setSnapshot(snap);
    expect(await getSnapshot()).toEqual(snap);

    // Replaces prior snapshot.
    const snap2: Snapshot = { ...snap, fetchedAt: 2000, tasks: [] };
    await setSnapshot(snap2);
    expect(await getSnapshot()).toEqual(snap2);
  });
});

describe('mutations queue', () => {
  const mk = (id: string, createdAt: number): PendingMutation => ({
    id,
    type: 'complete',
    taskId: `task-${id}`,
    taskListId: 'l1',
    createdAt,
  });

  it('enqueues and lists in insertion (createdAt) order', async () => {
    await enqueueMutation(mk('b', 200));
    await enqueueMutation(mk('a', 100));
    await enqueueMutation(mk('c', 300));
    const ids = (await listMutations()).map((m) => m.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('breaks createdAt ties by id', async () => {
    await enqueueMutation(mk('z', 100));
    await enqueueMutation(mk('a', 100));
    const ids = (await listMutations()).map((m) => m.id);
    expect(ids).toEqual(['a', 'z']);
  });

  it('deletes a mutation by id', async () => {
    await enqueueMutation(mk('a', 100));
    await enqueueMutation(mk('b', 200));
    await deleteMutation('a');
    const ids = (await listMutations()).map((m) => m.id);
    expect(ids).toEqual(['b']);
  });
});
