import { describe, expect, it } from 'vitest';
import {
  buildAddDueOptions,
  buildDueOptions,
  resolveAddTarget,
  selectDueOption,
} from './dueOptions';
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

// The Add Task screen's Due DROPDOWN renders exactly the options this helper
// builds, including "Someday" only when a Someday list is configured.
describe('buildAddDueOptions', () => {
  const today = new Date(2026, 8, 16); // Wed 2026-09-16

  it('is "No date" first and "Pick a date" last', () => {
    const options = buildAddDueOptions(today);
    expect(options[0]).toEqual({ key: 'none', label: 'No date', date: null });
    expect(options[options.length - 1]).toEqual({
      key: 'pick',
      label: 'Pick a date',
      date: null,
    });
  });

  it('has the includeToday snooze date options in the middle', () => {
    const options = buildAddDueOptions(today);
    const snooze = computeSnoozeOptions(today, { includeToday: true });
    // Middle = everything between "No date" and "Pick a date" (no Someday here).
    const middle = options.slice(1, -1);
    expect(middle.map((o) => o.key)).toEqual(snooze.map((o) => o.key));
    expect(middle.map((o) => ({ key: o.key, date: o.date }))).toEqual(
      snooze.map((o) => ({ key: o.key, date: o.date })),
    );
    expect(middle.map((o) => o.key)).toEqual([
      'today',
      'tomorrow',
      'laterThisWeek',
      'thisWeekend',
      'nextWeek',
      'nextMonth',
    ]);
  });

  it('omits "Someday" when no Someday list is configured', () => {
    const options = buildAddDueOptions(today);
    expect(options.map((o) => o.key)).not.toContain('someday');
    expect(buildAddDueOptions(today, { hasSomeday: false }).map((o) => o.key)).not.toContain(
      'someday',
    );
  });

  it('includes a dateless "Someday" just before "Pick a date" when configured', () => {
    const options = buildAddDueOptions(today, { hasSomeday: true });
    expect(options.map((o) => o.key)).toContain('someday');
    const someday = options.find((o) => o.key === 'someday')!;
    expect(someday).toEqual({ key: 'someday', label: 'Someday', date: null });
    // Immediately before the trailing "Pick a date".
    expect(options[options.length - 2].key).toBe('someday');
    expect(options[options.length - 1].key).toBe('pick');
  });
});

describe('resolveAddTarget', () => {
  const today = new Date(2026, 8, 16); // Wed 2026-09-16
  const withSomeday = buildAddDueOptions(today, { hasSomeday: true });
  const base = { defaultListId: 'default-list', somedayListId: 'someday-list' };

  it('someday → the Someday list, no due', () => {
    expect(
      resolveAddTarget({ dueKey: 'someday', pickedDate: '', options: withSomeday, ...base }),
    ).toEqual({ taskListId: 'someday-list' });
  });

  it('none → the default list, no due', () => {
    expect(
      resolveAddTarget({ dueKey: 'none', pickedDate: '', options: withSomeday, ...base }),
    ).toEqual({ taskListId: 'default-list' });
  });

  it('a dated option → the default list with that date', () => {
    const tomorrow = withSomeday.find((o) => o.key === 'tomorrow')!;
    expect(
      resolveAddTarget({
        dueKey: 'tomorrow',
        pickedDate: '',
        options: withSomeday,
        ...base,
      }),
    ).toEqual({ taskListId: 'default-list', due: tomorrow.date });
  });

  it('pick with a chosen date → the default list with that date', () => {
    expect(
      resolveAddTarget({
        dueKey: 'pick',
        pickedDate: '2027-03-04',
        options: withSomeday,
        ...base,
      }),
    ).toEqual({ taskListId: 'default-list', due: '2027-03-04' });
  });

  it('pick with no date → null (Add stays blocked)', () => {
    expect(
      resolveAddTarget({ dueKey: 'pick', pickedDate: '', options: withSomeday, ...base }),
    ).toBeNull();
  });

  it('someday with no Someday list configured → null', () => {
    expect(
      resolveAddTarget({
        dueKey: 'someday',
        pickedDate: '',
        options: withSomeday,
        defaultListId: 'default-list',
        somedayListId: null,
      }),
    ).toBeNull();
  });
});

describe('selectDueOption', () => {
  const today = new Date(2026, 8, 16); // Wed 2026-09-16
  const options = buildDueOptions(today);

  it('selects "No date" when the task has no due', () => {
    expect(selectDueOption(null, options)).toEqual({ key: 'none', pickedDate: '' });
    expect(selectDueOption(undefined, options)).toEqual({ key: 'none', pickedDate: '' });
  });

  it('selects the matching chip when the due equals one of the option dates', () => {
    const tomorrow = options.find((o) => o.key === 'tomorrow')!;
    expect(tomorrow.date).toBe('2026-09-17');
    expect(selectDueOption('2026-09-17', options)).toEqual({
      key: 'tomorrow',
      pickedDate: '',
    });
  });

  it('matches against the date-only prefix of an RFC3339 datetime', () => {
    const tomorrow = options.find((o) => o.key === 'tomorrow')!;
    expect(selectDueOption(`${tomorrow.date}T00:00:00.000Z`, options)).toEqual({
      key: 'tomorrow',
      pickedDate: '',
    });
  });

  it('falls back to "Pick a date" (prefilled) for any other date', () => {
    expect(selectDueOption('2027-03-04', options)).toEqual({
      key: 'pick',
      pickedDate: '2027-03-04',
    });
  });
});
