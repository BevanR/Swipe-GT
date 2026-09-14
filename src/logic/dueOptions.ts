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

/** Which Due chip should start selected, plus the value to prefill "Pick a date". */
export interface DueSelection {
  /** The `key` of the {@link DueOption} to pre-select. */
  key: string;
  /**
   * The date to prefill the inline "Pick a date" input with, as 'YYYY-MM-DD'.
   * Empty unless `key === 'pick'`.
   */
  pickedDate: string;
}

/**
 * Map an existing task due date onto the Edit screen's pre-selected Due chip.
 *
 * Rules (mirrors the Add screen's chip semantics):
 *  - no due (null/undefined) → the `none` ("No date") chip.
 *  - a due equal to one of the computed option dates → that option's chip.
 *  - any other date → the `pick` ("Pick a date") chip, with the date prefilled.
 *
 * The due is compared on its date-only prefix so a stored RFC3339 datetime and a
 * plain 'YYYY-MM-DD' both resolve. Pure and DOM-free so it can be unit-tested.
 */
export function selectDueOption(
  due: string | null | undefined,
  options: DueOption[],
): DueSelection {
  if (!due) return { key: 'none', pickedDate: '' };
  const dateOnly = due.slice(0, 10);
  const match = options.find((o) => o.date !== null && o.date === dateOnly);
  if (match) return { key: match.key, pickedDate: '' };
  return { key: 'pick', pickedDate: dateOnly };
}
