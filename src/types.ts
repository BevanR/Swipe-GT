// Shared type contracts for the whole app.
// This file is the single source of truth for data shapes. Later feature
// agents implement against these interfaces; do not change them without a
// coordinated migration.

export interface Task {
  id: string;
  taskListId: string;
  taskListTitle: string;
  title: string;
  due: string | null; // RFC3339 date (date only), or null
  status: 'needsAction' | 'completed';
  /**
   * Google's manual-order key for this task within its list. Sorts
   * lexicographically ascending to reproduce the user's "My order". Per-list.
   */
  position: string;
  notes?: string;
}

export interface TaskList {
  id: string;
  title: string;
}

export type ThemeName = 'inbox' | 'tasks';

/**
 * Which display view the list is showing. Every non-completed task lives in
 * EXACTLY ONE view (see logic/views.ts for the partition):
 *  - `now`:       overdue OR due today OR (no due date AND not in the Someday list).
 *  - `scheduled`: any future due date (any list).
 *  - `someday`:   in the Someday list AND no due date.
 */
export type ViewName = 'now' | 'scheduled' | 'someday';

export interface AuthState {
  accessToken: string;
  accessTokenExpiry: number; // epoch ms
}

export interface AppConfig {
  theme: ThemeName;
  auth: AuthState | null;
  /** The persisted display view. */
  view: ViewName;
  /**
   * The task list designated as the user's "Someday" list, or null when none is
   * chosen. Dateless tasks in this list are parked in the Someday view. A value
   * for a list that no longer exists is tolerated (treated as "none").
   */
  somedayListId: string | null;
}

export type TaskGroupKey = 'overdue' | 'today' | 'noDate';

export interface GroupedTasks {
  overdue: Task[];
  today: Task[];
  noDate: Task[];
}

export type SnoozeOptionKey =
  | 'today'
  | 'tomorrow'
  | 'laterThisWeek'
  | 'thisWeekend'
  | 'nextWeek'
  | 'nextMonth'
  // Clear the task's due date (moving it to Now). Dateless option; carries a
  // null `date`. Distinct from `someday`, which also clears the date but moves
  // the task into the Someday list.
  | 'nodate'
  | 'someday'
  // Dispatched only by the snooze menu's inline "Pick a date" input (never
  // produced by computeSnoozeOptions); carries a user-chosen `date`.
  | 'pick';

export interface SnoozeOption {
  key: SnoozeOptionKey;
  label: string;
  /**
   * RFC3339 date the task's due will be set to, or null for the special
   * "Someday" option, which carries no date (it parks the task instead).
   */
  date: string | null;
}

export type MutationType = 'complete' | 'snooze';

export interface PendingMutation {
  id: string; // uuid for the queue entry
  type: MutationType;
  taskId: string;
  taskListId: string;
  due?: string; // for snooze
  createdAt: number;
}

export interface Snapshot {
  fetchedAt: number;
  tasks: Task[];
  lists: TaskList[];
}
