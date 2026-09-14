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
 * @param today Reference "today"; defaults to `new Date()`.
 */
export function computeSnoozeOptions(_today: Date = new Date()): SnoozeOption[] {
  throw new Error('not implemented');
}
