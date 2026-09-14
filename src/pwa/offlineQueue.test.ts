import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TasksApi } from '../api/tasksApi';
import { _resetDbForTests, enqueueMutation, listMutations } from '../storage/db';
import { drainQueue } from './offlineQueue';
import type { PendingMutation } from '../types';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDbForTests();
});

function fakeApi() {
  return {
    complete: vi.fn(async () => {}),
    patchDue: vi.fn(async () => {}),
  };
}

const completeMut = (id: string, createdAt: number): PendingMutation => ({
  id,
  type: 'complete',
  taskId: `task-${id}`,
  taskListId: 'l1',
  createdAt,
});

const snoozeMut = (id: string, createdAt: number, due: string): PendingMutation => ({
  id,
  type: 'snooze',
  taskId: `task-${id}`,
  taskListId: 'l1',
  due,
  createdAt,
});

describe('drainQueue', () => {
  it('applies queued mutations oldest-first and removes them', async () => {
    const api = fakeApi();
    await enqueueMutation(completeMut('a', 100));
    await enqueueMutation(snoozeMut('b', 200, '2026-10-01'));

    await drainQueue(api as unknown as TasksApi);

    expect(api.complete).toHaveBeenCalledWith('l1', 'task-a');
    expect(api.patchDue).toHaveBeenCalledWith('l1', 'task-b', '2026-10-01');
    // Order: complete (oldest) before snooze.
    expect(api.complete.mock.invocationCallOrder[0]).toBeLessThan(
      api.patchDue.mock.invocationCallOrder[0],
    );
    expect(await listMutations()).toHaveLength(0);
  });

  it('stops on first failure and leaves remaining mutations queued', async () => {
    const api = fakeApi();
    await enqueueMutation(completeMut('a', 100));
    await enqueueMutation(completeMut('b', 200));
    await enqueueMutation(completeMut('c', 300));

    // Second call fails.
    api.complete
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        throw new Error('network down');
      });

    await expect(drainQueue(api as unknown as TasksApi)).rejects.toThrow('network down');

    // 'a' applied+removed; 'b' failed and 'c' never attempted -> both remain.
    expect(api.complete).toHaveBeenCalledTimes(2);
    const remaining = (await listMutations()).map((m) => m.id);
    expect(remaining).toEqual(['b', 'c']);
  });
});
