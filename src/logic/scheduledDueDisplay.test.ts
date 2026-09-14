import { describe, expect, it } from 'vitest';
import { scheduledDueDisplay } from './scheduledDueDisplay';
import { formatFullDate } from './dueLabel';

// Reference "today": Monday 2026-09-14.
const TODAY = new Date(2026, 8, 14);

describe('scheduledDueDisplay', () => {
  it('hides the date in the tomorrow bucket (header already says the day)', () => {
    expect(scheduledDueDisplay('tomorrow', '2026-09-15', TODAY)).toBe('hidden');
  });

  it('hides the date in weekday (dow-*) buckets', () => {
    expect(scheduledDueDisplay('dow-3', '2026-09-16', TODAY)).toBe('hidden');
    expect(scheduledDueDisplay('dow-0', '2026-09-20', TODAY)).toBe('hidden');
  });

  it('shows an absolute full date in the range buckets', () => {
    for (const key of ['next-week', 'later-this-month', 'next-month', 'later']) {
      expect(scheduledDueDisplay(key, '2026-09-22', TODAY)).toBe(
        formatFullDate('2026-09-22', TODAY),
      );
    }
    // Sanity: that is the absolute friendly form, not 'auto'/'hidden'.
    expect(scheduledDueDisplay('later', '2026-09-22', TODAY)).toBe('Tuesday 22 Sep');
  });

  it('hides when a range-bucket task somehow has no due date', () => {
    expect(scheduledDueDisplay('later', null, TODAY)).toBe('hidden');
  });
});
