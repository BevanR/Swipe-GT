import { describe, expect, it } from 'vitest';
import { formatDueLabel, formatFullDate } from './dueLabel';

// All `today` values are constructed from LOCAL calendar components
// (new Date(year, monthIndex, day)) so the tests are deterministic regardless
// of the CI timezone. monthIndex is 0-based, so month 8 === September.

describe('formatDueLabel — delta -8..+8 from a mid-week Wednesday', () => {
  // Wednesday 2026-09-16.
  const today = new Date(2026, 8, 16);

  const cases: Array<[number, string, string]> = [
    [-8, '2026-09-08', 'Tuesday 8 Sep'], // absolute (same year, no year)
    [-7, '2026-09-09', 'last week'],
    [-6, '2026-09-10', 'last Thursday'],
    [-5, '2026-09-11', 'last Friday'],
    [-4, '2026-09-12', 'last Saturday'],
    [-3, '2026-09-13', 'last Sunday'],
    [-2, '2026-09-14', 'last Monday'],
    [-1, '2026-09-15', 'yesterday'],
    [0, '2026-09-16', 'today'],
    [1, '2026-09-17', 'tomorrow'],
    [2, '2026-09-18', 'Friday'],
    [3, '2026-09-19', 'Saturday'],
    [4, '2026-09-20', 'Sunday'],
    [5, '2026-09-21', 'next week'], // due date is a Monday within the week
    [6, '2026-09-22', 'Tuesday'],
    [7, '2026-09-23', 'next week'],
    [8, '2026-09-24', 'Thursday 24 Sep'], // absolute (same year, no year)
  ];

  for (const [delta, due, expected] of cases) {
    it(`delta ${delta} (${due}) -> "${expected}"`, () => {
      expect(formatDueLabel(due, today)).toBe(expected);
    });
  }
});

describe('formatDueLabel — Sunday edge (Monday must not become "next week")', () => {
  // Sunday 2026-09-20.
  const sunday = new Date(2026, 8, 20);

  it('the next Monday (delta 1) is "tomorrow", not "next week"', () => {
    expect(formatDueLabel('2026-09-21', sunday)).toBe('tomorrow');
  });

  it('the following Monday (delta 8) is an absolute date', () => {
    expect(formatDueLabel('2026-09-28', sunday)).toBe('Monday 28 Sep');
  });
});

describe('formatDueLabel — Monday edge', () => {
  // Monday 2026-09-21.
  const monday = new Date(2026, 8, 21);

  it('the next Monday (delta 7) is "next week"', () => {
    expect(formatDueLabel('2026-09-28', monday)).toBe('next week');
  });
});

describe('formatDueLabel — Saturday edge', () => {
  // Saturday 2026-09-19.
  const saturday = new Date(2026, 8, 19);

  it('the upcoming Monday (delta 2) is "next week"', () => {
    expect(formatDueLabel('2026-09-21', saturday)).toBe('next week');
  });

  it('the upcoming Sunday (delta 1) is "tomorrow"', () => {
    expect(formatDueLabel('2026-09-20', saturday)).toBe('tomorrow');
  });
});

describe('formatDueLabel — absolute friendly format', () => {
  const today = new Date(2026, 8, 16); // Wednesday 2026-09-16

  it('day has no leading zero and month is the correct 3-letter name', () => {
    // 2026-10-05 is a Monday, delta 19.
    expect(formatDueLabel('2026-10-05', today)).toBe('Monday 5 Oct');
  });

  it('omits the year when the due year matches today', () => {
    const label = formatDueLabel('2026-11-30', today);
    expect(label).toBe('Monday 30 Nov');
    expect(label).not.toMatch(/2026/);
  });

  it('appends the year when the due year differs (Dec -> Jan crossover)', () => {
    // today Monday 2026-12-28; due 2027-01-05 (Tuesday), delta 8.
    const dec = new Date(2026, 11, 28);
    expect(formatDueLabel('2027-01-05', dec)).toBe('Tuesday 5 Jan 2027');
  });
});

describe('formatDueLabel — never emits an ISO date string', () => {
  const today = new Date(2026, 8, 16); // Wednesday 2026-09-16
  const samples = [
    '2020-01-01',
    '2026-09-24',
    '2027-01-05',
    '2030-12-31',
    '2026-02-15',
    '2026-10-05',
    '2025-07-04',
    '2099-11-11',
  ];

  for (const due of samples) {
    it(`output for ${due} contains no YYYY-MM-DD substring`, () => {
      expect(formatDueLabel(due, today)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  }
});

describe('formatFullDate — always absolute, never relative words', () => {
  const today = new Date(2026, 8, 16); // Wednesday 2026-09-16

  it('formats near dates absolutely (no relative words)', () => {
    expect(formatFullDate('2026-09-14', today)).toBe('Monday 14 Sep');
    expect(formatFullDate('2026-09-16', today)).toBe('Wednesday 16 Sep'); // not "today"
    expect(formatFullDate('2026-09-17', today)).toBe('Thursday 17 Sep'); // not "tomorrow"
  });

  it('omits the year in the same year, includes it otherwise', () => {
    expect(formatFullDate('2026-12-25', today)).toBe('Friday 25 Dec');
    expect(formatFullDate('2027-01-01', today)).toBe('Friday 1 Jan 2027');
  });

  it('never emits an ISO date', () => {
    expect(formatFullDate('2027-03-09', today)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
