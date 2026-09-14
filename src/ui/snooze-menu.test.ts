import { describe, expect, it } from 'vitest';
import { computeSnoozeOptions } from '../logic/snooze';

// The <snooze-menu> component renders exactly the options it is handed, one
// <md-list-item> per entry (label + date), and reports the picked option's key.
// It cannot be DOM-mounted here: Vitest's SSR transform preserves the class
// decorator / `accessor` syntax that Node's VM can't parse (the production
// client build lowers them, so the shipped app is fine). We therefore assert
// the contract the menu renders from — the shape of the options feeding it.
describe('snooze menu option source', () => {
  it('produces all five options on a mid-week day (Wed 2026-09-16)', () => {
    const options = computeSnoozeOptions(new Date(2026, 8, 16));
    expect(options.map((o) => o.key)).toEqual([
      'tomorrow',
      'laterThisWeek',
      'thisWeekend',
      'nextWeek',
      'nextMonth',
    ]);
    // Every rendered item needs a human label and an RFC3339 date.
    for (const o of options) {
      expect(o.label).toBeTruthy();
      expect(o.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('omits laterThisWeek on a Friday so the menu shows four items', () => {
    const options = computeSnoozeOptions(new Date(2026, 8, 18)); // Friday
    expect(options.map((o) => o.key)).not.toContain('laterThisWeek');
    expect(options).toHaveLength(4);
  });
});
