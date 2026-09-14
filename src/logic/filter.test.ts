import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { filterAndGroup } from './filter';

/** Build a minimal Task with a given id + due date for grouping tests. */
function task(
  id: string,
  due: string | null,
  status: Task['status'] = 'needsAction',
): Task {
  return {
    id,
    taskListId: 'list-1',
    taskListTitle: 'List 1',
    title: `Task ${id}`,
    due,
    status,
    position: '',
  };
}

const ids = (tasks: Task[]): string[] => tasks.map((t) => t.id);

// A fixed local reference "today". Constructed from local Y/M/D components so
// the tests are deterministic regardless of the runner's timezone.
const TODAY = new Date(2026, 5, 15); // 2026-06-15 (local)

describe('filterAndGroup', () => {
  it('excludes tasks due strictly in the future', () => {
    const result = filterAndGroup(
      [task('future1', '2026-06-16'), task('future2', '2026-12-31')],
      TODAY,
    );
    expect(result.overdue).toEqual([]);
    expect(result.today).toEqual([]);
    expect(result.noDate).toEqual([]);
  });

  it('buckets overdue, today, and noDate correctly', () => {
    const result = filterAndGroup(
      [
        task('over', '2026-06-14'),
        task('now', '2026-06-15'),
        task('none', null),
        task('future', '2026-06-16'),
      ],
      TODAY,
    );
    expect(ids(result.overdue)).toEqual(['over']);
    expect(ids(result.today)).toEqual(['now']);
    expect(ids(result.noDate)).toEqual(['none']);
  });

  it('treats due == today as today (inclusive boundary)', () => {
    const result = filterAndGroup([task('a', '2026-06-15')], TODAY);
    expect(ids(result.today)).toEqual(['a']);
    expect(result.overdue).toEqual([]);
  });

  it('treats due == yesterday as overdue', () => {
    const result = filterAndGroup([task('a', '2026-06-14')], TODAY);
    expect(ids(result.overdue)).toEqual(['a']);
    expect(result.today).toEqual([]);
  });

  it('returns empty groups for empty input', () => {
    const result = filterAndGroup([], TODAY);
    expect(result).toEqual({ overdue: [], today: [], noDate: [] });
  });

  it('preserves input order within each group (stable)', () => {
    const result = filterAndGroup(
      [
        task('o1', '2026-06-10'),
        task('n1', null),
        task('t1', '2026-06-15'),
        task('o2', '2026-06-01'),
        task('t2', '2026-06-15'),
        task('n2', null),
        task('o3', '2026-06-14'),
      ],
      TODAY,
    );
    expect(ids(result.overdue)).toEqual(['o1', 'o2', 'o3']);
    expect(ids(result.today)).toEqual(['t1', 't2']);
    expect(ids(result.noDate)).toEqual(['n1', 'n2']);
  });

  it('handles dates across a month boundary', () => {
    const july1 = new Date(2026, 6, 1); // 2026-07-01 local
    const result = filterAndGroup(
      [
        task('junLast', '2026-06-30'), // overdue (previous month)
        task('julFirst', '2026-07-01'), // today
        task('julSecond', '2026-07-02'), // future -> excluded
      ],
      july1,
    );
    expect(ids(result.overdue)).toEqual(['junLast']);
    expect(ids(result.today)).toEqual(['julFirst']);
    expect(result.noDate).toEqual([]);
  });

  it('handles dates across a year boundary', () => {
    const jan1 = new Date(2027, 0, 1); // 2027-01-01 local
    const result = filterAndGroup(
      [task('dec31', '2026-12-31'), task('jan1', '2027-01-01')],
      jan1,
    );
    expect(ids(result.overdue)).toEqual(['dec31']);
    expect(ids(result.today)).toEqual(['jan1']);
  });

  it('compares by local calendar date, avoiding UTC off-by-one', () => {
    // `today` late in the local day: in positive-offset zones the UTC date is
    // already the next calendar day, and in negative-offset zones a naive
    // `new Date("2026-06-15")` (UTC midnight) would land on the previous local
    // day. A task due on the same local date must still be grouped as "today".
    const lateToday = new Date(2026, 5, 15, 23, 30, 0); // 2026-06-15 23:30 local
    const result = filterAndGroup(
      [
        task('sameDay', '2026-06-15'),
        task('yesterday', '2026-06-14'),
        task('tomorrow', '2026-06-16'),
      ],
      lateToday,
    );
    expect(ids(result.today)).toEqual(['sameDay']);
    expect(ids(result.overdue)).toEqual(['yesterday']);
    expect(ids(result.today)).not.toContain('tomorrow');
  });

  it('excludes completed tasks regardless of due date', () => {
    const result = filterAndGroup(
      [
        task('doneOverdue', '2026-06-14', 'completed'),
        task('doneToday', '2026-06-15', 'completed'),
        task('doneNoDate', null, 'completed'),
        task('openToday', '2026-06-15', 'needsAction'),
      ],
      TODAY,
    );
    expect(ids(result.overdue)).toEqual([]);
    expect(ids(result.today)).toEqual(['openToday']);
    expect(ids(result.noDate)).toEqual([]);
  });

  it('defaults today to the current date when omitted', () => {
    // A far-future task is always excluded; a null-due task is always kept.
    // This exercises the default-parameter path without depending on the exact
    // current date.
    const result = filterAndGroup([task('none', null), task('far', '2999-12-31')]);
    expect(ids(result.noDate)).toEqual(['none']);
    expect(result.today).toEqual([]);
    expect(result.overdue).toEqual([]);
  });
});
