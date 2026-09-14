import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { matchesQuery, partitionSearch, searchTasks } from './search';

/** Build a minimal Task with a given id, title, due, and optional notes. */
function task(
  id: string,
  title: string,
  due: string | null = null,
  notes?: string,
): Task {
  return {
    id,
    taskListId: 'list-1',
    taskListTitle: 'List 1',
    title,
    due,
    status: 'needsAction',
    position: '',
    ...(notes != null ? { notes } : {}),
  };
}

const ids = (tasks: Task[]): string[] => tasks.map((t) => t.id);

describe('matchesQuery', () => {
  it('matches a case-insensitive substring of the title', () => {
    expect(matchesQuery(task('a', 'Buy Milk'), 'milk')).toBe(true);
    expect(matchesQuery(task('a', 'Buy Milk'), 'MILK')).toBe(true);
    expect(matchesQuery(task('a', 'Buy Milk'), 'uy mi')).toBe(true);
  });

  it('matches a substring of the notes when present', () => {
    expect(
      matchesQuery(task('a', 'Groceries', null, 'remember the OAT milk'), 'oat'),
    ).toBe(true);
  });

  it('returns false when neither title nor notes match', () => {
    expect(matchesQuery(task('a', 'Buy Milk', null, 'from the shop'), 'eggs')).toBe(
      false,
    );
  });

  it('does not throw and returns false on a title miss when notes is absent', () => {
    expect(matchesQuery(task('a', 'Buy Milk'), 'eggs')).toBe(false);
  });

  it('treats an empty or whitespace query as no filter (matches all)', () => {
    expect(matchesQuery(task('a', 'anything'), '')).toBe(true);
    expect(matchesQuery(task('a', 'anything'), '   ')).toBe(true);
  });

  it('trims surrounding whitespace on the query', () => {
    expect(matchesQuery(task('a', 'Buy Milk'), '  milk  ')).toBe(true);
  });
});

describe('searchTasks', () => {
  const tasks = [
    task('a', 'Buy Milk'),
    task('b', 'Call plumber', null, 'about the leak'),
    task('c', 'Email boss'),
  ];

  it('filters to matches, preserving order', () => {
    // 'k' matches "Milk" (title) and "leak" (notes), but not "Email boss".
    expect(ids(searchTasks(tasks, 'k'))).toEqual(['a', 'b']);
  });

  it('matches notes as well as titles', () => {
    expect(ids(searchTasks(tasks, 'leak'))).toEqual(['b']);
  });

  it('returns all tasks unchanged for an empty query', () => {
    expect(searchTasks(tasks, '')).toBe(tasks);
    expect(searchTasks(tasks, '   ')).toBe(tasks);
  });

  it('returns [] when nothing matches', () => {
    expect(searchTasks(tasks, 'zzz')).toEqual([]);
  });
});

describe('partitionSearch', () => {
  it('splits in-view matches from other matches, deduped by id', () => {
    const inViewTask = task('v1', 'view report', '2026-06-14');
    const viewTasks = [inViewTask, task('v2', 'unrelated', '2026-06-15')];
    const allTasks = [
      inViewTask, // also present in the full set — must not be duplicated
      task('o1', 'report later', '2026-06-20'),
      task('o2', 'report someday'), // no due date
      task('x', 'nothing here', '2026-06-18'),
    ];

    const { inView, other } = partitionSearch(viewTasks, allTasks, 'report');
    expect(ids(inView)).toEqual(['v1']);
    // o1 (dated) before o2 (no date); v1 excluded as it is already in-view.
    expect(ids(other)).toEqual(['o1', 'o2']);
  });

  it('orders other matches by due ascending with no-date last', () => {
    const other = partitionSearch(
      [],
      [
        task('nodate', 'match', null),
        task('late', 'match', '2026-12-31'),
        task('early', 'match', '2026-01-01'),
      ],
      'match',
    ).other;
    expect(ids(other)).toEqual(['early', 'late', 'nodate']);
  });

  it('keeps the view order for the in-view section', () => {
    // Simulates the default view's overdue → today → no-date ordering.
    const viewTasks = [
      task('overdue', 'match a', '2026-06-10'),
      task('today', 'match b', '2026-06-15'),
      task('nodate', 'match c', null),
    ];
    const { inView } = partitionSearch(viewTasks, viewTasks, 'match');
    expect(ids(inView)).toEqual(['overdue', 'today', 'nodate']);
  });

  it('returns empty sections for an empty query', () => {
    const tasks = [task('a', 'Buy Milk')];
    expect(partitionSearch(tasks, tasks, '')).toEqual({ inView: [], other: [] });
    expect(partitionSearch(tasks, tasks, '  ')).toEqual({ inView: [], other: [] });
  });

  it('yields an empty in-view section (no matches) while still surfacing other matches', () => {
    const viewTasks = [task('v', 'apples', '2026-06-14')];
    const allTasks = [...viewTasks, task('o', 'oranges', '2026-06-20')];
    const { inView, other } = partitionSearch(viewTasks, allTasks, 'orange');
    expect(inView).toEqual([]);
    expect(ids(other)).toEqual(['o']);
  });
});
