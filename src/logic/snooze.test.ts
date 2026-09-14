import { describe, expect, it } from 'vitest';
import type { SnoozeOption, SnoozeOptionKey } from '../types';
import { computeSnoozeOptions } from './snooze';

/** Map option key -> date for concise assertions. */
function byKey(options: SnoozeOption[]): Record<string, string | null> {
  return Object.fromEntries(options.map((o) => [o.key, o.date]));
}

const keys = (options: SnoozeOption[]): SnoozeOptionKey[] => options.map((o) => o.key);

// Reference week (all local): 2026-06-01 (Mon) .. 2026-06-07 (Sun).
// new Date(2026, 5, d) => June d, 2026 in local time.
const MON = new Date(2026, 5, 1);
const TUE = new Date(2026, 5, 2);
const WED = new Date(2026, 5, 3);
const THU = new Date(2026, 5, 4);
const FRI = new Date(2026, 5, 5);
const SAT = new Date(2026, 5, 6);
const SUN = new Date(2026, 5, 7);

describe('computeSnoozeOptions — per weekday', () => {
  it('Monday: laterThisWeek present (Mon→Wed), nextWeek is next Monday', () => {
    const opts = computeSnoozeOptions(MON);
    expect(keys(opts)).toEqual([
      'tomorrow',
      'laterThisWeek',
      'thisWeekend',
      'nextWeek',
      'nextMonth',
    ]);
    expect(byKey(opts)).toEqual({
      tomorrow: '2026-06-02',
      laterThisWeek: '2026-06-03',
      thisWeekend: '2026-06-06',
      nextWeek: '2026-06-08', // Monday -> next Monday (+7)
      nextMonth: '2026-07-01',
    });
  });

  it('Tuesday: laterThisWeek present (Tue→Thu)', () => {
    const opts = computeSnoozeOptions(TUE);
    expect(keys(opts)).toContain('laterThisWeek');
    expect(byKey(opts)).toEqual({
      tomorrow: '2026-06-03',
      laterThisWeek: '2026-06-04',
      thisWeekend: '2026-06-06',
      nextWeek: '2026-06-08',
      nextMonth: '2026-07-01',
    });
  });

  it('Wednesday: laterThisWeek present (Wed→Fri)', () => {
    const opts = computeSnoozeOptions(WED);
    expect(keys(opts)).toContain('laterThisWeek');
    expect(byKey(opts)).toEqual({
      tomorrow: '2026-06-04',
      laterThisWeek: '2026-06-05',
      thisWeekend: '2026-06-06',
      nextWeek: '2026-06-08',
      nextMonth: '2026-07-01',
    });
  });

  it('Thursday: laterThisWeek hidden', () => {
    const opts = computeSnoozeOptions(THU);
    expect(keys(opts)).toEqual(['tomorrow', 'thisWeekend', 'nextWeek', 'nextMonth']);
    expect(keys(opts)).not.toContain('laterThisWeek');
    expect(byKey(opts)).toEqual({
      tomorrow: '2026-06-05',
      thisWeekend: '2026-06-06',
      nextWeek: '2026-06-08',
      nextMonth: '2026-07-01',
    });
  });

  it('Friday: laterThisWeek hidden; thisWeekend is the next day (Sat)', () => {
    const opts = computeSnoozeOptions(FRI);
    expect(keys(opts)).not.toContain('laterThisWeek');
    expect(byKey(opts)).toEqual({
      tomorrow: '2026-06-06',
      thisWeekend: '2026-06-06',
      nextWeek: '2026-06-08',
      nextMonth: '2026-07-01',
    });
  });

  it('Saturday: laterThisWeek hidden; thisWeekend rolls to NEXT Saturday', () => {
    const opts = computeSnoozeOptions(SAT);
    expect(keys(opts)).not.toContain('laterThisWeek');
    expect(byKey(opts)).toEqual({
      tomorrow: '2026-06-07',
      thisWeekend: '2026-06-13', // not today (6/6); rolls +7
      nextWeek: '2026-06-08',
      nextMonth: '2026-07-01',
    });
  });

  it('Sunday: laterThisWeek hidden; thisWeekend is next Saturday; nextWeek is tomorrow', () => {
    const opts = computeSnoozeOptions(SUN);
    expect(keys(opts)).not.toContain('laterThisWeek');
    expect(byKey(opts)).toEqual({
      tomorrow: '2026-06-08',
      thisWeekend: '2026-06-13',
      nextWeek: '2026-06-08', // upcoming Monday
      nextMonth: '2026-07-01',
    });
  });
});

describe('computeSnoozeOptions — labels and shape', () => {
  it('emits the exact labels for each key', () => {
    const opts = computeSnoozeOptions(MON); // Monday shows all five
    const labels = Object.fromEntries(opts.map((o) => [o.key, o.label]));
    expect(labels).toEqual({
      tomorrow: 'Tomorrow',
      laterThisWeek: 'Later this week',
      thisWeekend: 'This weekend',
      nextWeek: 'Next week',
      nextMonth: 'Next month',
    });
  });

  it('always includes tomorrow', () => {
    for (const day of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
      expect(keys(computeSnoozeOptions(day))).toContain('tomorrow');
    }
  });

  it('laterThisWeek is present Mon–Wed and absent Thu–Sun', () => {
    expect(keys(computeSnoozeOptions(MON))).toContain('laterThisWeek');
    expect(keys(computeSnoozeOptions(TUE))).toContain('laterThisWeek');
    expect(keys(computeSnoozeOptions(WED))).toContain('laterThisWeek');
    for (const day of [THU, FRI, SAT, SUN]) {
      expect(keys(computeSnoozeOptions(day))).not.toContain('laterThisWeek');
    }
  });

  it('every date is a valid YYYY-MM-DD string', () => {
    for (const day of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
      for (const opt of computeSnoozeOptions(day)) {
        expect(opt.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe('computeSnoozeOptions — month / year rollover', () => {
  it('nextMonth rolls December → next January (year rollover)', () => {
    const dec28 = new Date(2026, 11, 28); // Mon 2026-12-28
    const opts = computeSnoozeOptions(dec28);
    expect(byKey(opts)).toEqual({
      tomorrow: '2026-12-29',
      laterThisWeek: '2026-12-30',
      thisWeekend: '2027-01-02',
      nextWeek: '2027-01-04',
      nextMonth: '2027-01-01',
    });
  });

  it('nextMonth for a normal month is the 1st of the following month', () => {
    const sep14 = new Date(2026, 8, 14); // 2026-09-14
    expect(byKey(computeSnoozeOptions(sep14)).nextMonth).toBe('2026-10-01');
  });

  it('handles a leap-day-adjacent date (2024-02-28 → 02-29)', () => {
    const feb28 = new Date(2024, 1, 28); // Wed 2024-02-28
    const opts = computeSnoozeOptions(feb28);
    expect(byKey(opts)).toEqual({
      tomorrow: '2024-02-29', // leap day exists
      laterThisWeek: '2024-03-01',
      thisWeekend: '2024-03-02',
      nextWeek: '2024-03-04',
      nextMonth: '2024-03-01',
    });
  });
});

describe('computeSnoozeOptions — defaults', () => {
  it('defaults today to the current date when omitted', () => {
    const opts = computeSnoozeOptions();
    expect(keys(opts)).toContain('tomorrow');
    expect(keys(opts)).toContain('nextMonth');
    for (const opt of opts) {
      expect(opt.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('computeSnoozeOptions — Today option (includeToday flag)', () => {
  it('is absent when opts is omitted', () => {
    expect(keys(computeSnoozeOptions(WED))).not.toContain('today');
  });

  it('is absent when opts.includeToday is false', () => {
    expect(keys(computeSnoozeOptions(WED, { includeToday: false }))).not.toContain('today');
  });

  it('is prepended (first) with today’s date when opts.includeToday is true', () => {
    const opts = computeSnoozeOptions(WED, { includeToday: true }); // Wed 2026-06-03
    expect(opts[0].key).toBe('today');
    expect(opts[0].label).toBe('Today');
    expect(opts[0].date).toBe('2026-06-03');
    // The rest of the menu is unchanged.
    expect(keys(opts)).toEqual([
      'today',
      'tomorrow',
      'laterThisWeek',
      'thisWeekend',
      'nextWeek',
      'nextMonth',
    ]);
  });

  it('uses the correct local date on a Friday', () => {
    const opts = computeSnoozeOptions(FRI, { includeToday: true }); // Fri 2026-06-05
    expect(byKey(opts).today).toBe('2026-06-05');
  });
});

describe('computeSnoozeOptions — Someday option (includeSomeday flag)', () => {
  it('is absent by default', () => {
    expect(keys(computeSnoozeOptions(WED))).not.toContain('someday');
  });

  it('is appended last with a null date when includeSomeday is true', () => {
    const opts = computeSnoozeOptions(WED, { includeSomeday: true });
    const last = opts[opts.length - 1];
    expect(last.key).toBe('someday');
    expect(last.label).toBe('Someday');
    expect(last.date).toBeNull();
  });

  it('coexists with the Today option (today first, someday last)', () => {
    const opts = computeSnoozeOptions(WED, { includeToday: true, includeSomeday: true });
    expect(opts[0].key).toBe('today');
    expect(opts[opts.length - 1].key).toBe('someday');
  });
});

describe('computeSnoozeOptions — Now option (includeNow flag)', () => {
  it('is absent by default and when includeNow is false', () => {
    expect(keys(computeSnoozeOptions(WED))).not.toContain('now');
    expect(keys(computeSnoozeOptions(WED, { includeNow: false }))).not.toContain('now');
  });

  it('is added with a null date and the "Now" label when includeNow is true', () => {
    const opts = computeSnoozeOptions(WED, { includeNow: true });
    const now = opts.find((o) => o.key === 'now');
    expect(now).toBeDefined();
    expect(now?.label).toBe('Now');
    expect(now?.date).toBeNull();
  });

  it('orders "Now" after the date options (right before Someday when both show)', () => {
    // Wed shows all five date options; with both flags the tail is [..., now, someday].
    const opts = computeSnoozeOptions(WED, { includeNow: true, includeSomeday: true });
    expect(keys(opts)).toEqual([
      'tomorrow',
      'laterThisWeek',
      'thisWeekend',
      'nextWeek',
      'nextMonth',
      'now',
      'someday',
    ]);
  });

  it('sits last when Someday is not shown, after all the date options', () => {
    const opts = computeSnoozeOptions(WED, { includeToday: true, includeNow: true });
    expect(opts[0].key).toBe('today');
    expect(opts[opts.length - 1].key).toBe('now');
  });

  it('ordering is stable across weekdays (always after nextMonth)', () => {
    for (const day of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
      const opts = computeSnoozeOptions(day, { includeNow: true });
      const k = keys(opts);
      expect(k[k.length - 1]).toBe('now');
      expect(k.indexOf('now')).toBe(k.indexOf('nextMonth') + 1);
    }
  });
});

describe('computeSnoozeOptions — Now/Someday matrix (both are dateless)', () => {
  // The task-card computes the include flags per task situation; here we assert
  // the menu shape each combination of flags produces.

  it('a dated task shows BOTH Now and Someday (both dateless, null date)', () => {
    const opts = computeSnoozeOptions(WED, { includeNow: true, includeSomeday: true });
    const now = opts.find((o) => o.key === 'now');
    const someday = opts.find((o) => o.key === 'someday');
    expect(now?.date).toBeNull();
    expect(someday?.date).toBeNull();
    expect(now?.label).toBe('Now');
    expect(someday?.label).toBe('Someday');
  });

  it('a dateless Now task shows only Someday (no Now)', () => {
    const opts = computeSnoozeOptions(WED, { includeNow: false, includeSomeday: true });
    expect(keys(opts)).not.toContain('now');
    expect(keys(opts)).toContain('someday');
  });

  it('a dateless Someday task shows only Now (no Someday)', () => {
    const opts = computeSnoozeOptions(WED, { includeNow: true, includeSomeday: false });
    expect(keys(opts)).toContain('now');
    expect(keys(opts)).not.toContain('someday');
  });
});
