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
export function filterAndGroup(_tasks: Task[], _today: Date = new Date()): GroupedTasks {
  throw new Error('not implemented');
}
