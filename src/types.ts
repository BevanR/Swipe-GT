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
  included: boolean; // local-only preference
}

export type ThemeName = 'inbox' | 'tasks';

/**
 * Which display view the list is showing. Both views render the same flat card
 * list from the already-fetched task set; they only differ in how tasks are
 * filtered at display time:
 *  - `default`: overdue + today + no-date (via filterAndGroup).
 *  - `future`:  tasks due strictly after today, sorted ascending.
 */
export type ViewName = 'default' | 'future';

export interface AuthState {
  accessToken: string;
  accessTokenExpiry: number; // epoch ms
}

export interface AppConfig {
  listInclusion: Record<string, boolean>; // taskListId -> included; absent id defaults to true
  theme: ThemeName;
  auth: AuthState | null;
  /** The persisted display view. */
  view: ViewName;
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
  | 'nextMonth';

export interface SnoozeOption {
  key: SnoozeOptionKey;
  label: string;
  date: string; // RFC3339 date the task's due will be set to
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
