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

/**
 * Build the ordered list of Due options offered on the Add Task screen's Due
 * DROPDOWN. Same as {@link buildDueOptions} but with a dateless `Someday` option
 * inserted just before `Pick a date` when a Someday list is configured:
 *  - `No date` (the default) — no due date, targets the Google default list.
 *  - the snooze menu's date options via `computeSnoozeOptions(today, {
 *    includeToday: true })` (Today … Next month), all targeting the default list.
 *  - `Someday` — ONLY when `opts.hasSomeday`; dateless, parks the task in the
 *    Someday list.
 *  - `Pick a date` — reveals an inline native date input for an arbitrary date.
 *
 * Pure and DOM-free so the option set can be asserted in a unit test.
 */
export function buildAddDueOptions(
  today: Date = new Date(),
  opts?: { hasSomeday?: boolean },
): DueOption[] {
  const snooze = computeSnoozeOptions(today, { includeToday: true });
  return [
    { key: 'none', label: 'No date', date: null },
    ...snooze.map((o) => ({ key: o.key, label: o.label, date: o.date })),
    ...(opts?.hasSomeday ? [{ key: 'someday', label: 'Someday', date: null }] : []),
    { key: 'pick', label: 'Pick a date', date: null },
  ];
}

/** The list + due a selected Add-screen Due option resolves to. */
export interface AddTarget {
  /** The task list the new task is created in. */
  taskListId: string;
  /** The RFC3339 date-only due, or undefined for the dateless options. */
  due?: string;
}

/**
 * Resolve the Add Task screen's current Due selection into the `{ taskListId,
 * due? }` handed to `controller.addTask`. Pure and DOM-free so it can be
 * unit-tested.
 *
 * Rules:
 *  - `someday` → the configured Someday list, no due.
 *  - `none`    → the default list, no due.
 *  - `pick`    → the default list with the chosen date; `null` (block Add) when
 *                no date has been chosen yet.
 *  - a dated option → the default list with that option's date.
 *
 * Returns `null` when the selection can't yet produce a valid target (only the
 * empty "Pick a date" case), so the caller can keep the Add action disabled.
 */
export function resolveAddTarget(args: {
  dueKey: string;
  pickedDate: string;
  options: DueOption[];
  defaultListId: string;
  somedayListId: string | null;
}): AddTarget | null {
  const { dueKey, pickedDate, options, defaultListId, somedayListId } = args;
  if (dueKey === 'someday') {
    if (!somedayListId) return null;
    return { taskListId: somedayListId };
  }
  if (dueKey === 'none') return { taskListId: defaultListId };
  if (dueKey === 'pick') {
    if (!pickedDate) return null;
    return { taskListId: defaultListId, due: pickedDate };
  }
  const opt = options.find((o) => o.key === dueKey);
  if (opt?.date) return { taskListId: defaultListId, due: opt.date };
  return { taskListId: defaultListId };
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
