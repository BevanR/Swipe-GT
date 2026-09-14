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
  position?: string;
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
          position: item.position ?? '',
          ...(item.notes != null ? { notes: item.notes } : {}),
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    // `tasks.list` is not guaranteed to be in position order, so sort explicitly
    // by the lexicographic `position` key to reproduce the user's manual order.
    out.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
    return out;
  }

  /**
   * Create a new task in a list. Sends `title`, and `due`/`notes` only when
   * provided; `due` is converted from a date-only string to the RFC3339
   * datetime form Google expects. Returns the created task mapped to our
   * {@link Task} shape (with `taskListId`/`taskListTitle` injected like
   * {@link listTasks}).
   */
  async insert(
    taskListId: string,
    input: { title: string; due?: string; notes?: string },
    taskListTitle?: string,
  ): Promise<Task> {
    const body = {
      title: input.title,
      ...(input.due != null ? { due: `${input.due}T00:00:00.000Z` } : {}),
      ...(input.notes != null ? { notes: input.notes } : {}),
    };
    const res = await this.request(
      `/lists/${encodeURIComponent(taskListId)}/tasks`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    const item = (await res.json()) as GoogleTask;
    return {
      id: item.id,
      taskListId,
      taskListTitle: taskListTitle ?? '',
      title: item.title ?? '',
      due: item.due ? item.due.slice(0, 10) : null,
      status: item.status ?? 'needsAction',
      position: item.position ?? '',
      ...(item.notes != null ? { notes: item.notes } : {}),
    };
  }

  /**
   * Update a task's editable fields via PATCH. Sends only the provided fields;
   * `due` (a date-only string) is converted to the RFC3339 datetime Google
   * expects. NOTE: this method never sends `due: null` — clearing a date goes
   * through {@link clearDue} instead (see the caller in the controller). Returns
   * the updated task mapped to our {@link Task} shape.
   */
  async updateTask(
    taskListId: string,
    taskId: string,
    changes: { title?: string; notes?: string; due?: string },
    taskListTitle?: string,
  ): Promise<Task> {
    const body = {
      ...(changes.title !== undefined ? { title: changes.title } : {}),
      ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
      ...(changes.due !== undefined ? { due: `${changes.due}T00:00:00.000Z` } : {}),
    };
    const res = await this.request(
      `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    );
    const item = (await res.json()) as GoogleTask;
    return {
      id: item.id,
      taskListId,
      taskListTitle: taskListTitle ?? '',
      title: item.title ?? '',
      due: item.due ? item.due.slice(0, 10) : null,
      status: item.status ?? 'needsAction',
      position: item.position ?? '',
      ...(item.notes != null ? { notes: item.notes } : {}),
    };
  }

  /** Delete a task from a list. */
  async deleteTask(taskListId: string, taskId: string): Promise<void> {
    await this.request(
      `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'DELETE' },
    );
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

  /**
   * Clear a task's due date (make it dateless) — used when parking a task to the
   * Someday list. Implemented as a PATCH with an explicit `due: null` body,
   * which is the documented JSON way to unset a field on a task resource.
   *
   * NOTE: Google Tasks has historically been finicky about clearing `due` — some
   * clients report that `due: null` via PATCH is ignored and fall back to a full
   * `tasks.update` (PUT) with `due` omitted. We deliberately use PATCH+null here;
   * the real-API behaviour of clearing a date will be verified manually by the
   * user. If PATCH proves unreliable in production, switch to a PUT of the whole
   * task with `due` omitted.
   */
  async clearDue(taskListId: string, taskId: string): Promise<void> {
    await this.request(
      `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ due: null }),
      },
    );
  }

  /**
   * Move a task to another task list via the Tasks `move` endpoint. Google
   * returns the moved task as it now exists in the destination list; we map it
   * to our {@link Task} shape with `taskListId` set to the destination list id.
   *
   * Note: Google rejects moving a recurring task between lists — the request
   * fails and {@link request} throws; the caller decides how to surface that.
   */
  async move(
    taskListId: string,
    taskId: string,
    destinationTasklist: string,
    destinationTitle?: string,
  ): Promise<Task> {
    const query = new URLSearchParams({ destinationTasklist });
    const res = await this.request(
      `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(
        taskId,
      )}/move?${query.toString()}`,
      { method: 'POST' },
    );
    const item = (await res.json()) as GoogleTask;
    return {
      id: item.id,
      taskListId: destinationTasklist,
      taskListTitle: destinationTitle ?? '',
      title: item.title ?? '',
      due: item.due ? item.due.slice(0, 10) : null,
      status: item.status ?? 'needsAction',
      position: item.position ?? '',
      ...(item.notes != null ? { notes: item.notes } : {}),
    };
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
