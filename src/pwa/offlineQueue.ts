import type { TasksApi } from '../api/tasksApi';
import { enqueueMutation } from '../storage/db';

// Re-export the queue-write primitive so callers can enqueue without reaching
// into the storage layer directly.
export { enqueueMutation };

/**
 * Drain the offline mutation queue, applying each pending mutation via the
 * given {@link TasksApi} and removing it on success. Intended to run on
 * reconnect / app start. Should be resilient to partial failure (stop or skip
 * on error, leaving un-applied mutations queued).
 */
export async function drainQueue(_api: TasksApi): Promise<void> {
  throw new Error('not implemented');
}
