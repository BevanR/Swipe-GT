// Fixtures shaped to match the Google Tasks REST API responses. These back the
// MSW handlers and are also handy for unit tests that need realistic payloads.
//
// "Today" for these fixtures is 2026-09-14 (see the app's reference date in
// tests). Dates are RFC3339 date-time at UTC midnight, exactly as Google
// returns date-only `due` values.

export interface GoogleTaskListResource {
  kind: 'tasks#taskList';
  id: string;
  etag: string;
  title: string;
  updated: string;
  selfLink: string;
}

export interface GoogleTaskResource {
  kind: 'tasks#task';
  id: string;
  etag: string;
  title: string;
  updated: string;
  selfLink: string;
  position: string;
  status: 'needsAction' | 'completed';
  due?: string;
  notes?: string;
}

/** Two task lists. `@default` is the built-in "My Tasks" list. */
export const taskListFixtures: GoogleTaskListResource[] = [
  {
    kind: 'tasks#taskList',
    id: '@default',
    etag: '"etag-list-default"',
    title: 'My Tasks',
    updated: '2026-09-10T08:00:00.000Z',
    selfLink: 'https://tasks.googleapis.com/tasks/v1/users/@me/lists/@default',
  },
  {
    kind: 'tasks#taskList',
    id: 'MTIzNDU2Nzg5',
    etag: '"etag-list-work"',
    title: 'Work',
    updated: '2026-09-12T09:30:00.000Z',
    selfLink: 'https://tasks.googleapis.com/tasks/v1/users/@me/lists/MTIzNDU2Nzg5',
  },
];

/** Tasks keyed by task-list id, in the shape Google returns them. */
export const taskFixtures: Record<string, GoogleTaskResource[]> = {
  '@default': [
    {
      kind: 'tasks#task',
      id: 'task-overdue-1',
      etag: '"etag-1"',
      title: 'Renew passport',
      updated: '2026-08-30T10:00:00.000Z',
      selfLink: 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/task-overdue-1',
      position: '00000000000000000000',
      status: 'needsAction',
      due: '2026-09-01T00:00:00.000Z',
    },
    {
      kind: 'tasks#task',
      id: 'task-today-1',
      etag: '"etag-2"',
      title: 'Call the dentist',
      updated: '2026-09-13T18:00:00.000Z',
      selfLink: 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/task-today-1',
      position: '00000000000000000001',
      status: 'needsAction',
      due: '2026-09-14T00:00:00.000Z',
    },
    {
      kind: 'tasks#task',
      id: 'task-nodate-1',
      etag: '"etag-3"',
      title: 'Read that book someday',
      updated: '2026-07-01T12:00:00.000Z',
      selfLink: 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/task-nodate-1',
      position: '00000000000000000002',
      status: 'needsAction',
    },
  ],
  MTIzNDU2Nzg5: [
    {
      kind: 'tasks#task',
      id: 'task-overdue-2',
      etag: '"etag-4"',
      title: 'Submit expense report',
      updated: '2026-08-19T09:00:00.000Z',
      selfLink: 'https://tasks.googleapis.com/tasks/v1/lists/MTIzNDU2Nzg5/tasks/task-overdue-2',
      position: '00000000000000000000',
      status: 'needsAction',
      due: '2026-08-20T00:00:00.000Z',
      notes: 'Q3 travel, keep receipts.',
    },
    {
      kind: 'tasks#task',
      id: 'task-today-2',
      etag: '"etag-5"',
      title: 'Prep standup notes',
      updated: '2026-09-14T06:00:00.000Z',
      selfLink: 'https://tasks.googleapis.com/tasks/v1/lists/MTIzNDU2Nzg5/tasks/task-today-2',
      position: '00000000000000000001',
      status: 'needsAction',
      due: '2026-09-14T00:00:00.000Z',
    },
    {
      kind: 'tasks#task',
      id: 'task-future-1',
      etag: '"etag-6"',
      title: 'Plan Q4 offsite',
      updated: '2026-09-05T11:00:00.000Z',
      selfLink: 'https://tasks.googleapis.com/tasks/v1/lists/MTIzNDU2Nzg5/tasks/task-future-1',
      position: '00000000000000000002',
      status: 'needsAction',
      due: '2026-12-25T00:00:00.000Z',
    },
  ],
};

/** Deep clone of the fixtures for mutable in-memory handler state. */
export function cloneTaskListFixtures(): GoogleTaskListResource[] {
  return taskListFixtures.map((l) => ({ ...l }));
}

export function cloneTaskFixtures(): Record<string, GoogleTaskResource[]> {
  const out: Record<string, GoogleTaskResource[]> = {};
  for (const [listId, tasks] of Object.entries(taskFixtures)) {
    out[listId] = tasks.map((t) => ({ ...t }));
  }
  return out;
}
