import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AppConfig, PendingMutation, Snapshot } from '../types';

/**
 * Default app configuration used when nothing has been persisted yet. Theme is
 * 'tasks' (the preferred look), there is no auth state, the default view is
 * 'now', and no Someday list is chosen.
 */
export const DEFAULT_CONFIG: AppConfig = {
  theme: 'tasks',
  auth: null,
  view: 'now',
  somedayListId: null,
};

/** The display views the app knows how to render. */
const VALID_VIEWS: ReadonlyArray<AppConfig['view']> = ['now', 'scheduled', 'someday'];

/**
 * Map a legacy persisted view name to a current one. Older builds stored
 * `'default'` (now `'now'`) and `'future'` (now `'scheduled'`); anything else
 * unknown falls back to `'now'`.
 */
function migrateView(view: unknown): AppConfig['view'] {
  if (view === 'default') return 'now';
  if (view === 'future') return 'scheduled';
  if (typeof view === 'string' && (VALID_VIEWS as readonly string[]).includes(view)) {
    return view as AppConfig['view'];
  }
  return 'now';
}

const DB_NAME = 'g-tasks';
const DB_VERSION = 1;

const CONFIG_STORE = 'config';
const SNAPSHOT_STORE = 'snapshot';
const MUTATIONS_STORE = 'mutations';

/** Fixed single-record keys for the singleton stores. */
const CONFIG_KEY = 'app';
const SNAPSHOT_KEY = 'current';

interface GTasksDB extends DBSchema {
  config: {
    key: string;
    value: AppConfig;
  };
  snapshot: {
    key: string;
    value: Snapshot;
  };
  mutations: {
    key: string;
    value: PendingMutation;
  };
}

let dbPromise: Promise<IDBPDatabase<GTasksDB>> | null = null;

function getDb(): Promise<IDBPDatabase<GTasksDB>> {
  if (!dbPromise) {
    dbPromise = openDB<GTasksDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(CONFIG_STORE)) {
          db.createObjectStore(CONFIG_STORE);
        }
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
          db.createObjectStore(SNAPSHOT_STORE);
        }
        if (!db.objectStoreNames.contains(MUTATIONS_STORE)) {
          db.createObjectStore(MUTATIONS_STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Reset the cached database connection. Primarily for tests that swap the
 * underlying IndexedDB implementation between cases.
 */
export function _resetDbForTests(): void {
  dbPromise = null;
}

/** Read the persisted {@link AppConfig}, falling back to {@link DEFAULT_CONFIG}. */
export async function getConfig(): Promise<AppConfig> {
  const db = await getDb();
  const stored = (await db.get(CONFIG_STORE, CONFIG_KEY)) as
    | (Partial<AppConfig> & { listInclusion?: unknown })
    | undefined;
  const merged: AppConfig = { ...DEFAULT_CONFIG, ...stored };
  // Migrate legacy view names ('default'→'now', 'future'→'scheduled') and guard
  // against any stale/unknown value so we never render an unknown view.
  merged.view = migrateView(stored?.view);
  // Drop any legacy `listInclusion` field that a previous version persisted; the
  // include feature no longer exists.
  if ('listInclusion' in merged) {
    delete (merged as { listInclusion?: unknown }).listInclusion;
  }
  return merged;
}

/** Merge a partial config patch into the persisted {@link AppConfig}. */
export async function setConfig(patch: Partial<AppConfig>): Promise<void> {
  const db = await getDb();
  const current = await getConfig();
  const next: AppConfig = { ...current, ...patch };
  await db.put(CONFIG_STORE, next, CONFIG_KEY);
}

/** Read the last cached {@link Snapshot}, or null if none has been stored. */
export async function getSnapshot(): Promise<Snapshot | null> {
  const db = await getDb();
  const stored = await db.get(SNAPSHOT_STORE, SNAPSHOT_KEY);
  return stored ?? null;
}

/** Persist the latest {@link Snapshot}, replacing any prior one. */
export async function setSnapshot(s: Snapshot): Promise<void> {
  const db = await getDb();
  await db.put(SNAPSHOT_STORE, s, SNAPSHOT_KEY);
}

/** Append a mutation to the offline queue. */
export async function enqueueMutation(m: PendingMutation): Promise<void> {
  const db = await getDb();
  await db.put(MUTATIONS_STORE, m);
}

/** List all queued mutations in insertion order (by createdAt, then id). */
export async function listMutations(): Promise<PendingMutation[]> {
  const db = await getDb();
  const all = await db.getAll(MUTATIONS_STORE);
  return all.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Remove a queued mutation by its queue-entry id. */
export async function deleteMutation(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(MUTATIONS_STORE, id);
}
