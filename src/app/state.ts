import type { GroupedTasks, Task, TaskList, ThemeName, ViewName } from '../types';

/** Which top-level screen the app is showing. */
export type Screen = 'loading' | 'connect' | 'list' | 'settings';

/** The complete, serializable UI state owned by the controller. */
export interface AppState {
  screen: Screen;
  /** Overdue/today/no-date grouping for the Now view. */
  grouped: GroupedTasks;
  /** Future-dated tasks for the Scheduled view (sorted by due asc). */
  scheduled: Task[];
  /** Dateless Someday-list tasks for the Someday view (by position asc). */
  someday: Task[];
  /** Every fetched non-completed task, across all lists (drives search). */
  allTasks: Task[];
  /** The active display view. */
  view: ViewName;
  /** The designated Someday list id, or null when none is chosen. */
  somedayListId: string | null;
  /** Task lists from the most recent tasklists.list (for the settings screen). */
  lists: TaskList[];
  theme: ThemeName;
  /** True when the visible tasks came from the cached snapshot, not a live fetch. */
  fromCache: boolean;
  /** True when the browser reports it is offline. */
  offline: boolean;
  /** epoch ms of the snapshot / fetch currently shown, or null. */
  fetchedAt: number | null;
  /** True while a (re)fetch is in flight. */
  loading: boolean;
  /** Transient snackbar message, or null. */
  toast: string | null;
  /** True after connecting fails, so the connect screen can show a hint. */
  connectError: boolean;
}

/** The empty grouped-tasks value. */
export const EMPTY_GROUPS: GroupedTasks = { overdue: [], today: [], noDate: [] };

/** The initial state before boot resolves. */
export function initialState(theme: ThemeName): AppState {
  return {
    screen: 'loading',
    grouped: EMPTY_GROUPS,
    scheduled: [],
    someday: [],
    allTasks: [],
    view: 'now',
    somedayListId: null,
    lists: [],
    theme,
    fromCache: false,
    offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    fetchedAt: null,
    loading: false,
    toast: null,
    connectError: false,
  };
}
