import type { GroupedTasks, Task } from '../types';

/**
 * Filter tasks down to those relevant "now" and group them for display.
 *
 * Inclusion rule: a task is included if its `due` is null (no date) OR its due
 * date is on/before `today` (i.e. `due <= today`). Tasks due strictly in the
 * future are excluded.
 *
 * Grouping:
 *  - `overdue`: due date strictly before today.
 *  - `today`:   due date equal to today.
 *  - `noDate`:  `due` is null.
 *
 * @param tasks  Tasks to filter/group.
 * @param today  Reference "today"; defaults to `new Date()`. Compared by
 *               calendar date (date-only), not by time-of-day.
 */
export function filterAndGroup(tasks: Task[], today: Date = new Date()): GroupedTasks {
  // Derive today's calendar date in LOCAL time as a comparable 'YYYY-MM-DD'
  // string. We never parse `due` via `new Date(due)` because 'YYYY-MM-DD'
  // parses as UTC midnight, which can shift the calendar day for non-UTC
  // locales. Comparing the canonical date-strings lexicographically is exact
  // for the fixed 'YYYY-MM-DD' format.
  const todayStr = toLocalDateString(today);

  const overdue: Task[] = [];
  const todayGroup: Task[] = [];
  const noDate: Task[] = [];

  for (const task of tasks) {
    if (task.due === null) {
      noDate.push(task);
      continue;
    }

    const dueStr = normalizeDueDate(task.due);

    if (dueStr < todayStr) {
      overdue.push(task);
    } else if (dueStr === todayStr) {
      todayGroup.push(task);
    }
    // else: due strictly in the future -> excluded entirely.
  }

  return { overdue, today: todayGroup, noDate };
}

/** Format a Date's LOCAL calendar date as 'YYYY-MM-DD'. */
function toLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Reduce a due value to its date-only 'YYYY-MM-DD' prefix. `due` is documented
 * as a date-only RFC3339 value, but if a full timestamp ever slips through we
 * only ever compare the date part.
 */
function normalizeDueDate(due: string): string {
  return due.slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}
