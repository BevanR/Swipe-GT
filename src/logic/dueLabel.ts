/**
 * Human-friendly relative label for a task's due date.
 *
 * Pure and deterministic: all reasoning is done on LOCAL calendar dates, and
 * every output string is built from fixed weekday/month arrays (never
 * `toLocaleDateString`) so results do not vary with the CI locale or timezone.
 */

/** Full weekday names indexed by `Date.prototype.getDay()` (0 = Sunday). */
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** 3-letter month names indexed by `Date.prototype.getMonth()` (0 = January). */
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Format a due date as a friendly relative label.
 *
 * @param due   Date-only string 'YYYY-MM-DD' (never null; callers handle null).
 * @param today Reference "today"; defaults to `new Date()`. Only its LOCAL
 *              calendar date is used.
 * @returns Labels such as `today`, `tomorrow`, `yesterday`, `next week`,
 *          `last week`, a weekday like `Tuesday` / `last Friday`, or an
 *          absolute friendly date like `Tuesday 15 Sep` (with a trailing year
 *          only when it differs from today's year). Never an ISO date string.
 */
export function formatDueLabel(due: string, today: Date = new Date()): string {
  // Parse the Y/M/D parts directly. Do NOT `new Date(due)` — that parses a
  // date-only string as UTC midnight and can shift the day in local time.
  const [dy, dm, dd] = due.split('-').map(Number) as [number, number, number];

  // Today's LOCAL calendar date.
  const ty = today.getFullYear();
  const tm = today.getMonth(); // 0-indexed
  const td = today.getDate();

  // Whole-day calendar difference. Both endpoints go through Date.UTC so the
  // arithmetic is DST-free; the values are still the LOCAL Y/M/D components.
  const MS_PER_DAY = 86_400_000;
  const dueUtc = Date.UTC(dy, dm - 1, dd);
  const todayUtc = Date.UTC(ty, tm, td);
  const delta = Math.round((dueUtc - todayUtc) / MS_PER_DAY);

  // Local weekday of the due date (0 = Sunday .. 6 = Saturday).
  const dueDow = new Date(dy, dm - 1, dd).getDay();

  // Order matters: the exact-delta rows win over the ranged weekday rows, so
  // e.g. an upcoming Monday at delta 1 resolves to `tomorrow`, not `next week`.
  if (delta === 0) return 'today';
  if (delta === 1) return 'tomorrow';
  if (delta === -1) return 'yesterday';
  if (delta === 7) return 'next week';
  if (delta === -7) return 'last week';

  if (delta >= 2 && delta <= 6) {
    // Monday (dow === 1) within the coming week reads as `next week`.
    return dueDow === 1 ? 'next week' : WEEKDAYS[dueDow];
  }

  if (delta >= -6 && delta <= -2) {
    return `last ${WEEKDAYS[dueDow]}`;
  }

  // |delta| >= 8: absolute friendly date.
  const label = `${WEEKDAYS[dueDow]} ${dd} ${MONTHS_SHORT[dm - 1]}`;
  return dy === ty ? label : `${label} ${dy}`;
}

/**
 * Format a due date as an ALWAYS-absolute friendly date, e.g. `Monday 14 Sep`
 * (with a trailing year only when it differs from today's year). Unlike
 * `formatDueLabel`, this never returns relative words — used where the concrete
 * date matters regardless of proximity (e.g. the snooze menu subtitles).
 *
 * @param date  Date-only string 'YYYY-MM-DD'.
 * @param today Reference for the "same year" check; defaults to `new Date()`.
 */
export function formatFullDate(date: string, today: Date = new Date()): string {
  const [dy, dm, dd] = date.split('-').map(Number) as [number, number, number];
  const dueDow = new Date(dy, dm - 1, dd).getDay();
  const label = `${WEEKDAYS[dueDow]} ${dd} ${MONTHS_SHORT[dm - 1]}`;
  return dy === today.getFullYear() ? label : `${label} ${dy}`;
}
