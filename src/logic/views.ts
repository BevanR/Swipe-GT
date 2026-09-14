/**
 * The single source of truth for the three-view partition.
 *
 * Every non-completed task belongs to EXACTLY ONE of the three views. The rules
 * are, for a task with `status === 'needsAction'`:
 *  - **Now**: overdue OR due today OR (no due date AND NOT in the Someday list).
 *  - **Scheduled**: any strictly-future due date (any list).
 *  - **Someday**: no due date AND in the Someday list.
 *
 * This is exhaustive and mutually exclusive. Split by due date first — a task is
 * either overdue, due-today, future, or dateless, and those four cases never
 * overlap:
 *  - overdue → Now
 *  - today → Now
 *  - future → Scheduled
 *  - dateless → Someday if it is in the Someday list, otherwise Now.
 * So a dated task in the Someday list still lands in Now/Scheduled (only its due
 * date matters); only *dateless* Someday-list tasks live in Someday. When
 * `somedayListId` is null, no task can be in the Someday list, so Someday is
 * empty and every dateless task falls to Now.
 *
 * All reasoning is on LOCAL calendar dates via canonical 'YYYY-MM-DD' string
 * comparison — never `new Date('YYYY-MM-DD')`, which parses as UTC midnight and
 * can shift the calendar day in non-UTC locales.
 */

import type { GroupedTasks, Task } from '../types';

export interface PartitionedViews {
  /** The Now view, grouped overdue / today / no-date for display. */
  now: GroupedTasks;
  /** The Scheduled view: future-dated tasks, sorted by due asc then position. */
  scheduled: Task[];
  /** The Someday view: dateless tasks in the Someday list, by position asc. */
  someday: Task[];
}

/** Format a Date's LOCAL calendar date as 'YYYY-MM-DD'. */
function toLocalDateString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).padStart(4, '0')}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Partition tasks into the three views. Completed tasks are excluded from all
 * three (defensive: a task completed offline can linger in a cached snapshot).
 */
export function partitionViews(
  tasks: Task[],
  somedayListId: string | null,
  today: Date = new Date(),
): PartitionedViews {
  const todayStr = toLocalDateString(today);

  const overdue: Task[] = [];
  const todayGroup: Task[] = [];
  const noDate: Task[] = [];
  const scheduled: Task[] = [];
  const someday: Task[] = [];

  for (const task of tasks) {
    if (task.status !== 'needsAction') continue;

    if (task.due === null) {
      // Dateless: Someday when in the designated list, otherwise Now's no-date.
      if (somedayListId !== null && task.taskListId === somedayListId) {
        someday.push(task);
      } else {
        noDate.push(task);
      }
      continue;
    }

    const dueStr = task.due.slice(0, 10);
    if (dueStr < todayStr) {
      overdue.push(task); // overdue → Now
    } else if (dueStr === todayStr) {
      todayGroup.push(task); // today → Now
    } else {
      scheduled.push(task); // future → Scheduled
    }
  }

  scheduled.sort(compareDueThenPosition);
  someday.sort(comparePosition);

  return {
    now: { overdue, today: todayGroup, noDate },
    scheduled,
    someday,
  };
}

function compareDueThenPosition(a: Task, b: Task): number {
  const da = (a.due as string).slice(0, 10);
  const db = (b.due as string).slice(0, 10);
  if (da !== db) return da < db ? -1 : 1;
  return comparePosition(a, b);
}

function comparePosition(a: Task, b: Task): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return 0;
}
