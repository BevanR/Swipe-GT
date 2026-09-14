import { describe, expect, it } from 'vitest';
import { buildDueOptions } from './dueOptions';
import { computeSnoozeOptions } from './snooze';

// The Add Task screen renders exactly the options this pure helper builds, so we
// assert the option set here without any DOM.
describe('buildDueOptions', () => {
  it('is "No date" first, then the snooze date options, then "Pick a date"', () => {
    const today = new Date(2026, 8, 16); // Wed 2026-09-16
    const options = buildDueOptions(today);

    // No date leads and is the (default-selected) dateless option.
    expect(options[0]).toEqual({ key: 'none', label: 'No date', date: null });
    // Pick a date is last and dateless (the user reveals an input to choose).
    expect(options[options.length - 1]).toEqual({
      key: 'pick',
      label: 'Pick a date',
      date: null,
    });

    // The middle is exactly the snooze menu's date options (Today included, no
    // Someday move option), in order.
    const snooze = computeSnoozeOptions(today, { includeToday: true });
    const middle = options.slice(1, -1);
    expect(middle.map((o) => o.key)).toEqual(snooze.map((o) => o.key));
    expect(middle.map((o) => o.key)).toEqual([
      'today',
      'tomorrow',
      'laterThisWeek',
      'thisWeekend',
      'nextWeek',
      'nextMonth',
    ]);
    for (const o of middle) {
      expect(o.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('never includes the dateless Someday move option', () => {
    const options = buildDueOptions(new Date(2026, 8, 16));
    expect(options.map((o) => o.key)).not.toContain('someday');
  });
});
