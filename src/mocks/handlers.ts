import { http, HttpResponse } from 'msw';
import {
  cloneTaskFixtures,
  cloneTaskListFixtures,
  type GoogleTaskListResource,
  type GoogleTaskResource,
} from './fixtures';

const BASE = 'https://tasks.googleapis.com/tasks/v1';

// Small page sizes so pagination is exercised even with the fixture data.
const LISTS_PAGE_SIZE = 1;
const TASKS_PAGE_SIZE = 2;

// Mutable in-memory state so PATCH results are observable across requests
// within a test. Call resetMockDb() (wired into afterEach) to restore.
let lists: GoogleTaskListResource[] = cloneTaskListFixtures();
let tasksByList: Record<string, GoogleTaskResource[]> = cloneTaskFixtures();

/** Restore the mock database to its pristine fixture state. */
export function resetMockDb(): void {
  lists = cloneTaskListFixtures();
  tasksByList = cloneTaskFixtures();
}

/** Read the current in-memory task (for test assertions). */
export function getMockTask(listId: string, taskId: string): GoogleTaskResource | undefined {
  return (tasksByList[listId] ?? []).find((t) => t.id === taskId);
}

function requireAuth(request: Request): Response | null {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return HttpResponse.json({ error: { code: 401, message: 'Missing bearer token' } }, { status: 401 });
  }
  return null;
}

/** Paginate an array using an integer-offset page token. */
function paginate<T>(
  items: T[],
  pageSize: number,
  pageToken: string | null,
): { page: T[]; nextPageToken?: string } {
  const start = pageToken ? Number(pageToken) : 0;
  const page = items.slice(start, start + pageSize);
  const nextStart = start + pageSize;
  if (nextStart < items.length) {
    return { page, nextPageToken: String(nextStart) };
  }
  return { page };
}

export const handlers = [
  // GET task lists
  http.get(`${BASE}/users/@me/lists`, ({ request }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const url = new URL(request.url);
    const { page, nextPageToken } = paginate(lists, LISTS_PAGE_SIZE, url.searchParams.get('pageToken'));
    return HttpResponse.json({
      kind: 'tasks#taskLists',
      items: page,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
  }),

  // GET tasks in a list
  http.get(`${BASE}/lists/:listId/tasks`, ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const listId = params.listId as string;
    const url = new URL(request.url);
    const showCompleted = url.searchParams.get('showCompleted') !== 'false';
    let items = tasksByList[listId] ?? [];
    if (!showCompleted) {
      items = items.filter((t) => t.status !== 'completed');
    }
    const { page, nextPageToken } = paginate(items, TASKS_PAGE_SIZE, url.searchParams.get('pageToken'));
    return HttpResponse.json({
      kind: 'tasks#tasks',
      items: page,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
  }),

  // POST a new task into a list
  http.post(`${BASE}/lists/:listId/tasks`, async ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const listId = params.listId as string;
    const body = (await request.json()) as Partial<GoogleTaskResource>;
    const id = `task-new-${(tasksByList[listId]?.length ?? 0) + 1}`;
    const created: GoogleTaskResource = {
      kind: 'tasks#task',
      id,
      etag: '"etag-new"',
      title: body.title ?? '',
      updated: '2026-09-14T12:00:00.000Z',
      selfLink: `${BASE}/lists/${listId}/tasks/${id}`,
      position: '00000000000000000099',
      status: 'needsAction',
      ...(typeof body.due === 'string' ? { due: body.due } : {}),
      ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
    };
    (tasksByList[listId] ??= []).push(created);
    return HttpResponse.json(created);
  }),

  // PATCH a task (due date / completion)
  http.patch(`${BASE}/lists/:listId/tasks/:taskId`, async ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const listId = params.listId as string;
    const taskId = params.taskId as string;
    const list = tasksByList[listId];
    const task = list?.find((t) => t.id === taskId);
    if (!task) {
      return HttpResponse.json({ error: { code: 404, message: 'Task not found' } }, { status: 404 });
    }
    const body = (await request.json()) as Partial<GoogleTaskResource> & { due?: string | null };
    // An explicit `due: null` clears the date (clearDue); a string sets it.
    if (body.due === null) delete task.due;
    else if (typeof body.due === 'string') task.due = body.due;
    if (body.status === 'completed' || body.status === 'needsAction') task.status = body.status;
    if (typeof body.title === 'string') task.title = body.title;
    if (typeof body.notes === 'string') task.notes = body.notes;
    return HttpResponse.json(task);
  }),

  // DELETE a task from a list
  http.delete(`${BASE}/lists/:listId/tasks/:taskId`, ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const listId = params.listId as string;
    const taskId = params.taskId as string;
    const list = tasksByList[listId];
    const idx = list ? list.findIndex((t) => t.id === taskId) : -1;
    if (!list || idx === -1) {
      return HttpResponse.json({ error: { code: 404, message: 'Task not found' } }, { status: 404 });
    }
    list.splice(idx, 1);
    // Google returns 204 No Content on a successful delete.
    return new HttpResponse(null, { status: 204 });
  }),

  // POST move a task to another list (destinationTasklist query param)
  http.post(`${BASE}/lists/:listId/tasks/:taskId/move`, ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const listId = params.listId as string;
    const taskId = params.taskId as string;
    const url = new URL(request.url);
    const dest = url.searchParams.get('destinationTasklist');
    const list = tasksByList[listId];
    const idx = list ? list.findIndex((t) => t.id === taskId) : -1;
    if (!list || idx === -1 || !dest) {
      return HttpResponse.json({ error: { code: 404, message: 'Task not found' } }, { status: 404 });
    }
    const [task] = list.splice(idx, 1);
    (tasksByList[dest] ??= []).push(task);
    return HttpResponse.json(task);
  }),
];
