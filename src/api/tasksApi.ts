import type { Task } from '../types';

/** Base URL for the Google Tasks REST API (v1). */
export const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';

/** A function that resolves to a currently-valid OAuth access token. */
export type TokenGetter = () => Promise<string>;

/** Shape of a task-list item in the Google REST response. */
interface GoogleTaskList {
  id: string;
  title: string;
}

/** Shape of a task item in the Google REST response. */
interface GoogleTask {
  id: string;
  title?: string;
  due?: string;
  status?: 'needsAction' | 'completed';
  notes?: string;
}

interface GoogleListResponse<T> {
  items?: T[];
  nextPageToken?: string;
}

/**
 * Thin client over the Google Tasks REST API. All requests are authorized with
 * a bearer token obtained lazily from the supplied {@link TokenGetter}.
 */
export class TasksApi {
  private readonly getToken: TokenGetter;

  constructor(getToken: TokenGetter) {
    this.getToken = getToken;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.getToken();
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init?.body != null && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await fetch(`${TASKS_API_BASE}${path}`, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google Tasks API ${res.status} ${res.statusText}: ${text}`);
    }
    return res;
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.request(path);
    return (await res.json()) as T;
  }

  /** List the user's task lists (paginated). */
  async listTaskLists(): Promise<{ id: string; title: string }[]> {
    const out: { id: string; title: string }[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ maxResults: '100' });
      if (pageToken) query.set('pageToken', pageToken);
      const data = await this.getJson<GoogleListResponse<GoogleTaskList>>(
        `/users/@me/lists?${query.toString()}`,
      );
      for (const item of data.items ?? []) {
        out.push({ id: item.id, title: item.title });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  /**
   * List tasks in a single task list, mapped to our {@link Task} shape with
   * `taskListId` and `taskListTitle` injected (the Google payload omits them).
   * The optional `taskListTitle` lets the app pass the title it already holds
   * from {@link listTaskLists} so each task carries a display title.
   */
  async listTasks(taskListId: string, taskListTitle?: string): Promise<Task[]> {
    const out: Task[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({
        showCompleted: 'false',
        showHidden: 'false',
        maxResults: '100',
      });
      if (pageToken) query.set('pageToken', pageToken);
      const data = await this.getJson<GoogleListResponse<GoogleTask>>(
        `/lists/${encodeURIComponent(taskListId)}/tasks?${query.toString()}`,
      );
      for (const item of data.items ?? []) {
        out.push({
          id: item.id,
          taskListId,
          taskListTitle: taskListTitle ?? '',
          title: item.title ?? '',
          due: item.due ? item.due.slice(0, 10) : null,
          status: item.status ?? 'needsAction',
          ...(item.notes != null ? { notes: item.notes } : {}),
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** Patch a task's due date (RFC3339 date) — used to implement snooze. */
  async patchDue(taskListId: string, taskId: string, due: string): Promise<void> {
    await this.request(
      `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ due: `${due}T00:00:00.000Z` }),
      },
    );
  }

  /** Mark a task completed. */
  async complete(taskListId: string, taskId: string): Promise<void> {
    await this.request(
      `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      },
    );
  }
}
