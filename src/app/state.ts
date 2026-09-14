import type { GroupedTasks, TaskList, ThemeName } from '../types';

/** Which top-level screen the app is showing. */
export type Screen = 'loading' | 'connect' | 'list' | 'settings';

/** The complete, serializable UI state owned by the controller. */
export interface AppState {
  screen: Screen;
  grouped: GroupedTasks;
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
