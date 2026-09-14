import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { getMockTask } from '../mocks/handlers';
import { TASKS_API_BASE, TasksApi } from './tasksApi';

const makeApi = (token = 'test-token') => new TasksApi(async () => token);

describe('TasksApi.listTaskLists', () => {
  it('maps items to {id,title} and follows pagination', async () => {
    const api = makeApi();
    const lists = await api.listTaskLists();
    // Fixtures define two lists; handler pages them one at a time.
    expect(lists).toEqual([
      { id: '@default', title: 'My Tasks' },
      { id: 'MTIzNDU2Nzg5', title: 'Work' },
    ]);
  });

  it('sends a bearer token', async () => {
    let seen: string | null = null;
    server.use(
      http.get(`${TASKS_API_BASE}/users/@me/lists`, ({ request }) => {
        seen = request.headers.get('Authorization');
        return HttpResponse.json({ items: [] });
      }),
    );
    await makeApi('tok-123').listTaskLists();
    expect(seen).toBe('Bearer tok-123');
  });
});

describe('TasksApi.listTasks', () => {
  it('maps to Task shape, converts due datetime to date, and paginates', async () => {
    const api = makeApi();
    const tasks = await api.listTasks('@default', 'My Tasks');
    expect(tasks).toHaveLength(3);

    const overdue = tasks.find((t) => t.id === 'task-overdue-1')!;
    expect(overdue).toEqual({
      id: 'task-overdue-1',
      taskListId: '@default',
      taskListTitle: 'My Tasks',
      title: 'Renew passport',
      due: '2026-09-01',
      status: 'needsAction',
      position: '00000000000000000000',
    });

    const nodate = tasks.find((t) => t.id === 'task-nodate-1')!;
    expect(nodate.due).toBeNull();
  });

  it('returns tasks sorted by position ascending even when the API returns them out of order', async () => {
    // The @default fixture is deliberately stored out of position order.
    const tasks = await makeApi().listTasks('@default', 'My Tasks');
    // Sorted by their lexicographic `position` key (…0000, …0001, …0002).
    expect(tasks.map((t) => t.id)).toEqual([
      'task-overdue-1',
      'task-today-1',
      'task-nodate-1',
    ]);
    expect(tasks.map((t) => t.position)).toEqual([
      '00000000000000000000',
      '00000000000000000001',
      '00000000000000000002',
    ]);
  });

  it('includes notes when present and defaults taskListTitle to empty', async () => {
    const tasks = await makeApi().listTasks('MTIzNDU2Nzg5');
    const withNotes = tasks.find((t) => t.id === 'task-overdue-2')!;
    expect(withNotes.notes).toBe('Q3 travel, keep receipts.');
    expect(withNotes.taskListTitle).toBe('');
  });
});

describe('TasksApi.patchDue', () => {
  it('PATCHes an RFC3339 datetime built from the date', async () => {
    let body: unknown;
    server.use(
      http.patch(`${TASKS_API_BASE}/lists/:l/tasks/:t`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    await makeApi().patchDue('@default', 'task-today-1', '2026-10-05');
    expect(body).toEqual({ due: '2026-10-05T00:00:00.000Z' });
  });

  it('updates the mock task state', async () => {
    await makeApi().patchDue('@default', 'task-today-1', '2026-10-05');
    expect(getMockTask('@default', 'task-today-1')?.due).toBe('2026-10-05T00:00:00.000Z');
  });
});

describe('TasksApi.complete', () => {
  it('PATCHes status completed', async () => {
    let body: unknown;
    server.use(
      http.patch(`${TASKS_API_BASE}/lists/:l/tasks/:t`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    await makeApi().complete('@default', 'task-today-1');
    expect(body).toEqual({ status: 'completed' });
  });

  it('applies completion against the mock state', async () => {
    await makeApi().complete('MTIzNDU2Nzg5', 'task-today-2');
    expect(getMockTask('MTIzNDU2Nzg5', 'task-today-2')?.status).toBe('completed');
  });
});

describe('TasksApi error handling', () => {
  it('throws including status on 401', async () => {
    server.use(
      http.get(`${TASKS_API_BASE}/users/@me/lists`, () =>
        HttpResponse.json({ error: 'nope' }, { status: 401 }),
      ),
    );
    await expect(makeApi().listTaskLists()).rejects.toThrow(/401/);
  });

  it('throws including status on 500', async () => {
    server.use(
      http.get(`${TASKS_API_BASE}/lists/:l/tasks`, () =>
        HttpResponse.text('boom', { status: 500 }),
      ),
    );
    await expect(makeApi().listTasks('@default')).rejects.toThrow(/500/);
  });
});
