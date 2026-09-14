import { computeSnoozeOptions } from './snooze';

/**
 * A selectable "Due" option for the Add Task screen. `date` is the RFC3339
 * date-only string the task's due will be set to, or null for the options that
 * carry no fixed date: `none` (leave the task undated) and `pick` (the user
 * reveals an inline date input and chooses any date).
 */
export interface DueOption {
  key: string;
  label: string;
  date: string | null;
}

/**
 * Build the ordered list of Due options offered on the Add Task screen:
 *  - `No date` (the default) — no due date.
 *  - the snooze menu's date options (Today, Tomorrow, Later this week, This
 *    weekend, Next week, Next month) via `computeSnoozeOptions(today, {
 *    includeToday: true })`. The dateless "Someday" move option is intentionally
 *    NOT included here — adding a task is not moving one to the Someday list.
 *  - `Pick a date` — reveals an inline native date input for an arbitrary date.
 *
 * Pure and DOM-free so the option set can be asserted in a unit test.
 */
export function buildDueOptions(today: Date = new Date()): DueOption[] {
  const snooze = computeSnoozeOptions(today, { includeToday: true });
  return [
    { key: 'none', label: 'No date', date: null },
    ...snooze.map((o) => ({ key: o.key, label: o.label, date: o.date })),
    { key: 'pick', label: 'Pick a date', date: null },
  ];
}
