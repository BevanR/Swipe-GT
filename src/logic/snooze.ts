import type { SnoozeOption } from '../types';

/**
 * Compute the snooze menu options relative to `today`.
 *
 * Menu rules (each option's `date` is an RFC3339 date-only string):
 *  - `tomorrow`:      today + 1 day. Always shown.
 *  - `laterThisWeek`: shifts to a mid/late weekday — Mon→Wed, Tue→Thu, Wed→Fri.
 *                     Hidden on Thu and Fri (would collide with the weekend
 *                     options), and not shown on Sat/Sun.
 *  - `thisWeekend`:   the upcoming Saturday. If today is already Sat or Sun,
 *                     this rolls to the following Saturday.
 *  - `nextWeek`:      the upcoming Monday (next Monday strictly after today).
 *  - `nextMonth`:     the 1st of next month.
 *
 * Options that do not apply for the given day (e.g. `laterThisWeek` on a
 * Thursday) are omitted from the returned array.
 *
 * All dates are built from LOCAL calendar components so that DST transitions
 * and month/year rollovers are handled correctly (never via UTC arithmetic).
 *
 * @param today Reference "today"; defaults to `new Date()`.
 * @param opts  Task context. When `opts.includeToday` is true, a `today` option
 *              (pull the task onto today) is prepended. Callers set this whenever
 *              the task is NOT already due exactly today — i.e. for overdue,
 *              future, and no-date tasks — and leave it false only when the due
 *              date already IS today (where "Today" would be a no-op). When
 *              `opts.includeSomeday` is true, a special dateless `someday` option
 *              is appended (park the task in the Someday list); its `date` is
 *              null. Callers set this only when a Someday list is configured and
 *              the task isn't already a dateless Someday-list task.
 */
export function computeSnoozeOptions(
  today: Date = new Date(),
  opts?: { includeToday?: boolean; includeSomeday?: boolean },
): SnoozeOption[] {
  // Local calendar anchor at local midnight; `getDay()` gives 0=Sun..6=Sat.
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-indexed
  const day = today.getDate();
  const dow = new Date(year, month, day).getDay();

  const options: SnoozeOption[] = [];

  // 0. Today — shown whenever the task isn't already due exactly today (pull an
  //    overdue, future, or no-date task onto today).
  if (opts?.includeToday) {
    options.push({
      key: 'today',
      label: 'Today',
      date: toLocalDateString(new Date(year, month, day)),
    });
  }

  // 1. Tomorrow — always shown.
  options.push({
    key: 'tomorrow',
    label: 'Tomorrow',
    date: addDays(year, month, day, 1),
  });

  // 2. Later this week — Mon/Tue/Wed only, always +2 days (Mon→Wed, Tue→Thu,
  //    Wed→Fri). Hidden Thu, Fri, Sat, Sun.
  if (dow >= 1 && dow <= 3) {
    options.push({
      key: 'laterThisWeek',
      label: 'Later this week',
      date: addDays(year, month, day, 2),
    });
  }

  // 3. This weekend — upcoming Saturday; if today is Sat/Sun, the following one.
  const daysToSat = dow === 6 ? 7 : (6 - dow + 7) % 7;
  options.push({
    key: 'thisWeekend',
    label: 'This weekend',
    date: addDays(year, month, day, daysToSat),
  });

  // 4. Next week — upcoming Monday; if today is Monday, the following one.
  const daysToMon = dow === 1 ? 7 : (1 - dow + 7) % 7;
  options.push({
    key: 'nextWeek',
    label: 'Next week',
    date: addDays(year, month, day, daysToMon),
  });

  // 5. Next month — the 1st of next calendar month (year rolls over in Dec).
  options.push({
    key: 'nextMonth',
    label: 'Next month',
    date: toLocalDateString(new Date(year, month + 1, 1)),
  });

  // 6. Someday — a dateless park option, appended last. Has no date.
  if (opts?.includeSomeday) {
    options.push({ key: 'someday', label: 'Someday', date: null });
  }

  return options;
}

/**
 * Return the LOCAL calendar date `n` days after (year, month, day) as
 * 'YYYY-MM-DD'. Using the Date constructor with an out-of-range day handles
 * month and year rollover in local time.
 */
function addDays(year: number, month: number, day: number, n: number): string {
  return toLocalDateString(new Date(year, month, day + n));
}

/** Format a Date's LOCAL calendar date as 'YYYY-MM-DD'. */
function toLocalDateString(d: Date): string {
  return `${pad4(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}
