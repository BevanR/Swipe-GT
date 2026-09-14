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

describe('TasksApi.insert', () => {
  it('POSTs to the tasks endpoint with title + due datetime (notes omitted) and maps the created task', async () => {
    let seenUrl: string | undefined;
    let seenMethod: string | undefined;
    let body: unknown;
    server.use(
      http.post(`${TASKS_API_BASE}/lists/:l/tasks`, async ({ request }) => {
        seenUrl = request.url;
        seenMethod = request.method;
        body = await request.json();
        return HttpResponse.json({
          kind: 'tasks#task',
          id: 'task-created-1',
          title: 'Buy milk',
          due: '2026-10-05T00:00:00.000Z',
          position: '00000000000000000042',
          status: 'needsAction',
        });
      }),
    );

    const created = await makeApi().insert(
      '@default',
      { title: 'Buy milk', due: '2026-10-05' },
      'My Tasks',
    );

    expect(seenMethod).toBe('POST');
    // The list id is URL-encoded like the other methods (@ → %40).
    expect(seenUrl).toBe(`${TASKS_API_BASE}/lists/%40default/tasks`);
    // due is converted to the RFC3339 datetime form; notes is omitted.
    expect(body).toEqual({ title: 'Buy milk', due: '2026-10-05T00:00:00.000Z' });
    expect(created).toEqual({
      id: 'task-created-1',
      taskListId: '@default',
      taskListTitle: 'My Tasks',
      title: 'Buy milk',
      due: '2026-10-05', // sliced to date-only
      status: 'needsAction',
      position: '00000000000000000042',
    });
  });

  it('omits due when not provided, defaults taskListTitle to empty, and maps position', async () => {
    let body: unknown;
    server.use(
      http.post(`${TASKS_API_BASE}/lists/:l/tasks`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          kind: 'tasks#task',
          id: 'task-created-2',
          title: 'No date task',
          position: '00000000000000000001',
          status: 'needsAction',
        });
      }),
    );

    const created = await makeApi().insert('@default', { title: 'No date task' });

    expect(body).toEqual({ title: 'No date task' });
    expect(created.due).toBeNull();
    expect(created.taskListTitle).toBe('');
    expect(created.position).toBe('00000000000000000001');
  });

  it('sends notes only when provided', async () => {
    let body: unknown;
    server.use(
      http.post(`${TASKS_API_BASE}/lists/:l/tasks`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'x', title: 'With notes', status: 'needsAction' });
      }),
    );
    await makeApi().insert('@default', { title: 'With notes', notes: 'remember this' });
    expect(body).toEqual({ title: 'With notes', notes: 'remember this' });
  });

  it('inserts against the mock db and throws on non-2xx', async () => {
    const api = makeApi();
    const created = await api.insert('@default', { title: 'Live insert' });
    expect(getMockTask('@default', created.id)?.title).toBe('Live insert');

    server.use(
      http.post(`${TASKS_API_BASE}/lists/:l/tasks`, () =>
        HttpResponse.text('boom', { status: 500 }),
      ),
    );
    await expect(makeApi().insert('@default', { title: 'nope' })).rejects.toThrow(/500/);
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

describe('TasksApi.clearDue', () => {
  it('PATCHes an explicit due:null to clear the date', async () => {
    let body: unknown;
    let method: string | undefined;
    server.use(
      http.patch(`${TASKS_API_BASE}/lists/:l/tasks/:t`, async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    await makeApi().clearDue('@default', 'task-today-1');
    expect(method).toBe('PATCH');
    expect(body).toEqual({ due: null });
  });

  it('clears the date against the mock state', async () => {
    await makeApi().clearDue('@default', 'task-today-1');
    expect(getMockTask('@default', 'task-today-1')?.due).toBeUndefined();
  });
});

describe('TasksApi.updateTask', () => {
  it('PATCHes only the provided fields and converts due to a datetime', async () => {
    let seenUrl: string | undefined;
    let method: string | undefined;
    let body: unknown;
    server.use(
      http.patch(`${TASKS_API_BASE}/lists/:l/tasks/:t`, async ({ request }) => {
        seenUrl = request.url;
        method = request.method;
        body = await request.json();
        return HttpResponse.json({
          kind: 'tasks#task',
          id: 'task-today-1',
          title: 'New title',
          notes: 'New notes',
          due: '2026-10-05T00:00:00.000Z',
          position: '00000000000000000001',
          status: 'needsAction',
        });
      }),
    );

    const updated = await makeApi().updateTask(
      '@default',
      'task-today-1',
      { title: 'New title', notes: 'New notes', due: '2026-10-05' },
      'My Tasks',
    );

    expect(method).toBe('PATCH');
    expect(seenUrl).toBe(`${TASKS_API_BASE}/lists/%40default/tasks/task-today-1`);
    expect(body).toEqual({
      title: 'New title',
      notes: 'New notes',
      due: '2026-10-05T00:00:00.000Z',
    });
    expect(updated).toEqual({
      id: 'task-today-1',
      taskListId: '@default',
      taskListTitle: 'My Tasks',
      title: 'New title',
      due: '2026-10-05',
      status: 'needsAction',
      position: '00000000000000000001',
      notes: 'New notes',
    });
  });

  it('omits fields that are not provided (and never sends due:null)', async () => {
    let body: unknown;
    server.use(
      http.patch(`${TASKS_API_BASE}/lists/:l/tasks/:t`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'task-today-1', title: 'Only title', status: 'needsAction' });
      }),
    );
    await makeApi().updateTask('@default', 'task-today-1', { title: 'Only title' });
    expect(body).toEqual({ title: 'Only title' });
  });

  it('applies the update against the mock db', async () => {
    await makeApi().updateTask('@default', 'task-today-1', { title: 'Live edit' });
    expect(getMockTask('@default', 'task-today-1')?.title).toBe('Live edit');
  });
});

describe('TasksApi.deleteTask', () => {
  it('DELETEs the task endpoint', async () => {
    let seenUrl: string | undefined;
    let method: string | undefined;
    server.use(
      http.delete(`${TASKS_API_BASE}/lists/:l/tasks/:t`, ({ request }) => {
        seenUrl = request.url;
        method = request.method;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await makeApi().deleteTask('@default', 'task-today-1');
    expect(method).toBe('DELETE');
    expect(seenUrl).toBe(`${TASKS_API_BASE}/lists/%40default/tasks/task-today-1`);
  });

  it('removes the task from the mock db and throws on error', async () => {
    await makeApi().deleteTask('@default', 'task-today-1');
    expect(getMockTask('@default', 'task-today-1')).toBeUndefined();

    server.use(
      http.delete(`${TASKS_API_BASE}/lists/:l/tasks/:t`, () =>
        HttpResponse.text('boom', { status: 500 }),
      ),
    );
    await expect(makeApi().deleteTask('@default', 'missing')).rejects.toThrow(/500/);
  });
});

describe('TasksApi.move', () => {
  it('POSTs to the move endpoint with destinationTasklist and maps to the destination list', async () => {
    let seenUrl: string | undefined;
    let method: string | undefined;
    server.use(
      http.post(`${TASKS_API_BASE}/lists/:l/tasks/:t/move`, ({ request }) => {
        seenUrl = request.url;
        method = request.method;
        return HttpResponse.json({
          kind: 'tasks#task',
          id: 'task-1',
          title: 'Moved',
          position: '00000000000000000005',
          status: 'needsAction',
        });
      }),
    );

    const moved = await makeApi().move('@default', 'task-1', 'MTIzNDU2Nzg5', 'Work');

    expect(method).toBe('POST');
    // list id URL-encoded (@ → %40); destination as a query param.
    expect(seenUrl).toBe(
      `${TASKS_API_BASE}/lists/%40default/tasks/task-1/move?destinationTasklist=MTIzNDU2Nzg5`,
    );
    // The moved task carries the DESTINATION list id.
    expect(moved).toEqual({
      id: 'task-1',
      taskListId: 'MTIzNDU2Nzg5',
      taskListTitle: 'Work',
      title: 'Moved',
      due: null,
      status: 'needsAction',
      position: '00000000000000000005',
    });
  });

  it('moves the task between lists in the mock db', async () => {
    await makeApi().move('@default', 'task-today-1', 'MTIzNDU2Nzg5');
    expect(getMockTask('@default', 'task-today-1')).toBeUndefined();
    expect(getMockTask('MTIzNDU2Nzg5', 'task-today-1')?.title).toBe('Call the dentist');
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
