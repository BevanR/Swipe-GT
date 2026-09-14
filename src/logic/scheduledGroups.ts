/**
 * Group future (scheduled) tasks into human-friendly date buckets for the
 * Scheduled view.
 *
 * Pure and deterministic: all reasoning is on LOCAL calendar dates. Like
 * dueLabel.ts we parse the Y/M/D parts directly and do day arithmetic through
 * `Date.UTC` (DST-free) — never `new Date('YYYY-MM-DD')`, which parses as UTC
 * midnight and can shift the calendar day in non-UTC locales.
 */

import type { Task } from '../types';
import { WEEKDAYS } from './dueLabel';

/** One rendered section of the Scheduled view. */
export interface ScheduledGroup {
  /** Stable bucket key, e.g. `tomorrow`, `dow-3`, `next-week`, `later`. */
  key: string;
  /** Human-readable section heading, e.g. `Tomorrow`, `Wednesday`. */
  label: string;
  /** Tasks in this bucket, ordered by due date asc then position asc. */
  tasks: Task[];
}

const MS_PER_DAY = 86_400_000;

/** Parse a date-only 'YYYY-MM-DD' string to a DST-free UTC-day timestamp. */
function dueToUtcDay(due: string): number {
  const [y, m, d] = due.slice(0, 10).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return Date.UTC(y, m - 1, d);
}

/** A Date's LOCAL calendar date as a DST-free UTC-day timestamp. */
function localToUtcDay(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Group future tasks into ordered date buckets.
 *
 * The app passes tasks that are already future (`due != null && due > today`)
 * on included lists, but this function defensively ignores any task whose `due`
 * is null or falls on/before `today`.
 *
 * Buckets, in this order, each task assigned to the FIRST it matches; empty
 * buckets are omitted:
 *  1. `tomorrow` — due == today + 1.
 *  2. weekday buckets (`dow-N`) — the remaining days of THIS week after
 *     tomorrow, up to and including the coming Sunday; one per weekday, in
 *     chronological order.
 *  3. `next-week` — the Mon..Sun week following the coming Sunday.
 *  4. `later-this-month` — after next-week's Sunday but still within today's
 *     calendar month.
 *  5. `next-month` — within the next calendar month.
 *  6. `later` — anything after next month.
 *
 * @param tasks Future tasks to group.
 * @param today Reference "today"; defaults to `new Date()`. Only its LOCAL
 *              calendar date is used.
 */
export function groupScheduled(
  tasks: Task[],
  today: Date = new Date(),
): ScheduledGroup[] {
  const todayUtc = localToUtcDay(today);
  const todayDow = new Date(todayUtc).getUTCDay(); // 0 = Sunday
  // Soonest Sunday on/after today (today itself when today is Sunday).
  const daysUntilSunday = (7 - todayDow) % 7;
  const comingSundayUtc = todayUtc + daysUntilSunday * MS_PER_DAY;
  const nextWeekEndUtc = comingSundayUtc + 7 * MS_PER_DAY;

  const curY = today.getFullYear();
  const curM = today.getMonth(); // 0-indexed
  const nextM = (curM + 1) % 12;
  const nextY = curM === 11 ? curY + 1 : curY;

  // Canonical bucket order. Weekday slots are appended in chronological order so
  // e.g. Sunday (dow-0) sorts after Saturday (dow-6), not before Wednesday.
  const order: string[] = ['tomorrow'];
  for (
    let dayUtc = todayUtc + 2 * MS_PER_DAY;
    dayUtc <= comingSundayUtc;
    dayUtc += MS_PER_DAY
  ) {
    order.push(`dow-${new Date(dayUtc).getUTCDay()}`);
  }
  order.push('next-week', 'later-this-month', 'next-month', 'later');

  const labelFor = (key: string): string => {
    switch (key) {
      case 'tomorrow':
        return 'Tomorrow';
      case 'next-week':
        return 'Next week';
      case 'later-this-month':
        return 'Later this month';
      case 'next-month':
        return 'Next month';
      case 'later':
        return 'Later';
      default:
        // dow-N
        return WEEKDAYS[Number(key.slice(4))];
    }
  };

  const bucketOf = (dueUtc: number): string => {
    const delta = Math.round((dueUtc - todayUtc) / MS_PER_DAY);
    if (delta === 1) return 'tomorrow';
    if (dueUtc <= comingSundayUtc) return `dow-${new Date(dueUtc).getUTCDay()}`;
    if (dueUtc <= nextWeekEndUtc) return 'next-week';
    const d = new Date(dueUtc);
    const dy = d.getUTCFullYear();
    const dm = d.getUTCMonth();
    if (dy === curY && dm === curM) return 'later-this-month';
    if (dy === nextY && dm === nextM) return 'next-month';
    return 'later';
  };

  const byKey = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.due === null) continue;
    const dueUtc = dueToUtcDay(task.due);
    if (dueUtc <= todayUtc) continue; // defensively skip non-future tasks
    const key = bucketOf(dueUtc);
    const arr = byKey.get(key);
    if (arr) arr.push(task);
    else byKey.set(key, [task]);
  }

  const groups: ScheduledGroup[] = [];
  for (const key of order) {
    const bucketTasks = byKey.get(key);
    if (!bucketTasks || bucketTasks.length === 0) continue;
    bucketTasks.sort((a, b) => {
      const da = (a.due as string).slice(0, 10);
      const db = (b.due as string).slice(0, 10);
      if (da !== db) return da < db ? -1 : 1;
      if (a.position !== b.position) return a.position < b.position ? -1 : 1;
      return 0;
    });
    groups.push({ key, label: labelFor(key), tasks: bucketTasks });
  }
  return groups;
}
