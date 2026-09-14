import type { Task } from '../types';

/** Base URL for the Google Tasks REST API (v1). */
export const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';

/** A function that resolves to a currently-valid OAuth access token. */
export type TokenGetter = () => Promise<string>;

/**
 * Thin client over the Google Tasks REST API. All requests are authorized with
 * a bearer token obtained lazily from the supplied {@link TokenGetter}.
 */
export class TasksApi {
  private readonly getToken: TokenGetter;

  constructor(getToken: TokenGetter) {
    this.getToken = getToken;
  }

  /** List the user's task lists. */
  async listTaskLists(): Promise<{ id: string; title: string }[]> {
    // Feature agents: authorize requests with `await this.getToken()`.
    void this.getToken;
    throw new Error('not implemented');
  }

  /**
   * List tasks in a single task list, mapped to our {@link Task} shape with
   * `taskListId` and `taskListTitle` injected (the Google payload omits them).
   */
  async listTasks(_taskListId: string): Promise<Task[]> {
    throw new Error('not implemented');
  }

  /** Patch a task's due date (RFC3339 date) — used to implement snooze. */
  async patchDue(_taskListId: string, _taskId: string, _due: string): Promise<void> {
    throw new Error('not implemented');
  }

  /** Mark a task completed. */
  async complete(_taskListId: string, _taskId: string): Promise<void> {
    throw new Error('not implemented');
  }
}
