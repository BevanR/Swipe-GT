import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { groupScheduled } from './scheduledGroups';

// All `today` values are constructed from LOCAL calendar components
// (new Date(year, monthIndex, day)) so the tests are deterministic regardless
// of the CI timezone. monthIndex is 0-based, so month 8 === September.

/** Build a minimal future Task with a given id, due date, and position. */
function task(id: string, due: string | null, position = ''): Task {
  return {
    id,
    taskListId: 'list-1',
    taskListTitle: 'List 1',
    title: `Task ${id}`,
    due,
    status: 'needsAction',
    position,
  };
}

/** Convenience: map groups to [key, label, [ids...]] tuples. */
const shape = (groups: ReturnType<typeof groupScheduled>) =>
  groups.map((g) => [g.key, g.label, g.tasks.map((t) => t.id)] as const);

describe('groupScheduled — Monday today (full spread)', () => {
  // Monday 2026-09-14. Coming Sunday = 2026-09-20.
  const today = new Date(2026, 8, 14);

  const tasks: Task[] = [
    task('tue', '2026-09-15'), // tomorrow
    task('wed', '2026-09-16'), // Wednesday
    task('thu', '2026-09-17'), // Thursday
    task('fri', '2026-09-18'), // Friday
    task('sat', '2026-09-19'), // Saturday
    task('sun', '2026-09-20'), // Sunday (coming Sunday, earlier bucket)
    task('nextMon', '2026-09-21'), // next week (upcoming Monday)
    task('nextSun', '2026-09-27'), // next week (its Sunday)
    task('ltm', '2026-09-30'), // later this month
    task('nm', '2026-10-05'), // next month
    task('lat', '2026-12-01'), // later
  ];

  it('produces every bucket in order with correct labels + membership', () => {
    expect(shape(groupScheduled(tasks, today))).toEqual([
      ['tomorrow', 'Tomorrow', ['tue']],
      ['dow-3', 'Wednesday', ['wed']],
      ['dow-4', 'Thursday', ['thu']],
      ['dow-5', 'Friday', ['fri']],
      ['dow-6', 'Saturday', ['sat']],
      ['dow-0', 'Sunday', ['sun']],
      ['next-week', 'Next week', ['nextMon', 'nextSun']],
      ['later-this-month', 'Later this month', ['ltm']],
      ['next-month', 'Next month', ['nm']],
      ['later', 'Later', ['lat']],
    ]);
  });

  it('omits buckets that have no tasks', () => {
    const groups = groupScheduled(
      [task('tue', '2026-09-15'), task('lat', '2026-12-01')],
      today,
    );
    expect(shape(groups)).toEqual([
      ['tomorrow', 'Tomorrow', ['tue']],
      ['later', 'Later', ['lat']],
    ]);
  });
});

describe('groupScheduled — Sunday today (no this-week weekday buckets)', () => {
  // Sunday 2026-09-20. Coming Sunday = today. Tomorrow = Monday 2026-09-21.
  const today = new Date(2026, 8, 20);

  it('tomorrow is Monday and the rest of that week is Next week; no weekday buckets', () => {
    const tasks: Task[] = [
      task('mon', '2026-09-21'), // tomorrow (Monday)
      task('wedNext', '2026-09-23'), // next week (Wed of the coming week)
      task('sunNext', '2026-09-27'), // next week (its Sunday)
      task('ltm', '2026-09-30'), // later this month
    ];
    expect(shape(groupScheduled(tasks, today))).toEqual([
      ['tomorrow', 'Tomorrow', ['mon']],
      ['next-week', 'Next week', ['wedNext', 'sunNext']],
      ['later-this-month', 'Later this month', ['ltm']],
    ]);
  });

  it('Next week starts the Monday following Sunday (tomorrow), spanning its Tue..Sun', () => {
    // Coming Sunday == today, so Next week = today+1(Mon 21st)..today+7(Sun 27th).
    // The Monday (today+1) is claimed by the tomorrow bucket; Tue 22nd onward is
    // Next week. The day after next week's Sunday (today+8 = Mon 28th) is
    // Later this month, exactly like every other reference day.
    const groups = groupScheduled(
      [task('tueNext', '2026-09-22'), task('mon28', '2026-09-28')],
      today,
    );
    expect(shape(groups)).toEqual([
      ['next-week', 'Next week', ['tueNext']],
      ['later-this-month', 'Later this month', ['mon28']],
    ]);
  });
});

describe('groupScheduled — Saturday today', () => {
  // Saturday 2026-09-19. Coming Sunday = 2026-09-20 (tomorrow).
  const today = new Date(2026, 8, 19);

  it('tomorrow is Sunday, no weekday buckets, rest is Next week', () => {
    const tasks: Task[] = [
      task('sun', '2026-09-20'), // tomorrow (Sunday)
      task('mon', '2026-09-21'), // next week (Monday)
      task('sun2', '2026-09-27'), // next week (Sunday)
    ];
    expect(shape(groupScheduled(tasks, today))).toEqual([
      ['tomorrow', 'Tomorrow', ['sun']],
      ['next-week', 'Next week', ['mon', 'sun2']],
    ]);
  });
});

describe('groupScheduled — month-end spill leaves later-this-month empty', () => {
  // Monday 2026-11-23. Coming Sunday = 2026-11-29.
  // Next week = 2026-11-30 .. 2026-12-06 (spills into December).
  const today = new Date(2026, 10, 23);

  it('a next-week date in the next month stays in Next week; no Later this month', () => {
    const tasks: Task[] = [
      task('tue', '2026-11-24'), // tomorrow
      task('wed', '2026-11-25'), // Wednesday
      task('nwNov', '2026-11-30'), // next week (still Nov)
      task('nwDec', '2026-12-06'), // next week (Dec, spilled)
      task('nm', '2026-12-20'), // next month (December, after next week)
    ];
    const groups = groupScheduled(tasks, today);
    const keys = groups.map((g) => g.key);
    expect(keys).not.toContain('later-this-month');
    expect(shape(groups)).toEqual([
      ['tomorrow', 'Tomorrow', ['tue']],
      ['dow-3', 'Wednesday', ['wed']],
      ['next-week', 'Next week', ['nwNov', 'nwDec']],
      ['next-month', 'Next month', ['nm']],
    ]);
  });
});

describe('groupScheduled — year rollover (Dec -> Jan is Next month)', () => {
  // Monday 2026-12-28. Coming Sunday = 2027-01-03. Next week = Jan 4..10.
  const today = new Date(2026, 11, 28);

  it('January of the next year is Next month; February is Later', () => {
    const tasks: Task[] = [
      task('tue', '2026-12-29'), // tomorrow
      task('thu', '2026-12-31'), // Thursday (this week)
      task('nw', '2027-01-05'), // next week (Jan)
      task('nm', '2027-01-20'), // next month (Jan, after next week)
      task('lat', '2027-02-10'), // later (Feb)
    ];
    expect(shape(groupScheduled(tasks, today))).toEqual([
      ['tomorrow', 'Tomorrow', ['tue']],
      ['dow-4', 'Thursday', ['thu']],
      ['next-week', 'Next week', ['nw']],
      ['next-month', 'Next month', ['nm']],
      ['later', 'Later', ['lat']],
    ]);
  });
});

describe('groupScheduled — ordering within a bucket (due asc, then position asc)', () => {
  const today = new Date(2026, 8, 14); // Monday

  it('sorts by due date ascending, then position ascending, stably', () => {
    const tasks: Task[] = [
      task('b-later-due', '2026-10-20', '0001'),
      task('a-earlier-due', '2026-10-10', '9999'),
      task('c-same-due-pos-b', '2026-10-20', '0002'),
      task('d-same-due-pos-a', '2026-10-20', '0000'),
    ];
    const groups = groupScheduled(tasks, today);
    const nm = groups.find((g) => g.key === 'next-month');
    expect(nm?.tasks.map((t) => t.id)).toEqual([
      'a-earlier-due', // 10-10 first
      'd-same-due-pos-a', // 10-20, position 0000
      'b-later-due', // 10-20, position 0001
      'c-same-due-pos-b', // 10-20, position 0002
    ]);
  });
});

describe('groupScheduled — excludes null and non-future tasks', () => {
  const today = new Date(2026, 8, 14); // Monday 2026-09-14

  it('drops null due, past, and today tasks; keeps only strictly future', () => {
    const tasks: Task[] = [
      task('nullDue', null),
      task('past', '2026-09-10'),
      task('today', '2026-09-14'),
      task('future', '2026-09-15'),
    ];
    expect(shape(groupScheduled(tasks, today))).toEqual([
      ['tomorrow', 'Tomorrow', ['future']],
    ]);
  });

  it('returns an empty array when nothing is future', () => {
    expect(groupScheduled([task('x', null), task('y', '2026-09-14')], today)).toEqual(
      [],
    );
  });
});

describe('groupScheduled — boundary dates go to the earlier bucket', () => {
  const today = new Date(2026, 8, 14); // Monday 2026-09-14

  it('coming Sunday goes to its weekday bucket, not Next week', () => {
    const groups = groupScheduled([task('s', '2026-09-20')], today);
    expect(groups[0].key).toBe('dow-0');
  });

  it("next week's Sunday goes to Next week, not Later this month", () => {
    const groups = groupScheduled([task('s', '2026-09-27')], today);
    expect(groups[0].key).toBe('next-week');
  });
});
