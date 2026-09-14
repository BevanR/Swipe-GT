import type { TasksApi } from '../api/tasksApi';
import { deleteMutation, enqueueMutation, listMutations } from '../storage/db';

// Re-export the queue-write primitive so callers can enqueue without reaching
// into the storage layer directly.
export { enqueueMutation };

/**
 * Drain the offline mutation queue, applying each pending mutation via the
 * given {@link TasksApi} and removing it on success. Intended to run on
 * reconnect / app start. Mutations are applied oldest-first; on the first
 * failure the loop stops and rethrows, leaving that mutation and all later
 * ones queued so the caller can retry later.
 */
export async function drainQueue(api: TasksApi): Promise<void> {
  const mutations = await listMutations();
  for (const m of mutations) {
    if (m.type === 'complete') {
      await api.complete(m.taskListId, m.taskId);
    } else if (m.type === 'snooze') {
      if (m.due == null) {
        throw new Error(`snooze mutation ${m.id} is missing a due date`);
      }
      await api.patchDue(m.taskListId, m.taskId, m.due);
    }
    await deleteMutation(m.id);
  }
}
