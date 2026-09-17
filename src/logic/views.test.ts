import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { partitionViews } from './views';

// Reference "today" (local): 2026-09-14.
const TODAY = new Date(2026, 8, 14);

function task(
  id: string,
  due: string | null,
  taskListId = 'default',
  status: Task['status'] = 'needsAction',
  position = '',
): Task {
  return {
    id,
    taskListId,
    taskListTitle: taskListId,
    title: `Task ${id}`,
    due,
    status,
    position,
  };
}

const ids = (tasks: Task[]): string[] => tasks.map((t) => t.id);

describe('partitionViews — membership rules', () => {
  it('routes overdue/today to Now, future to Scheduled, dateless to Now when no someday list', () => {
    const { now, scheduled, someday } = partitionViews(
      [
        task('overdue', '2026-09-01'),
        task('today', '2026-09-14'),
        task('future', '2026-12-25'),
        task('dateless', null),
      ],
      null,
      TODAY,
    );
    expect(ids(now.overdue)).toEqual(['overdue']);
    expect(ids(now.today)).toEqual(['today']);
    expect(ids(now.noDate)).toEqual(['dateless']);
    expect(ids(scheduled)).toEqual(['future']);
    expect(someday).toEqual([]);
  });

  it('is exhaustive and mutually exclusive across every situation', () => {
    // One task in each of the eight (situation × in-someday-list?) combinations.
    const somedayId = 'park';
    const tasks = [
      task('overdue-other', '2026-09-01', 'other'),
      task('overdue-park', '2026-09-01', somedayId),
      task('today-other', '2026-09-14', 'other'),
      task('today-park', '2026-09-14', somedayId),
      task('future-other', '2026-12-25', 'other'),
      task('future-park', '2026-12-25', somedayId),
      task('dateless-other', null, 'other'),
      task('dateless-park', null, somedayId),
    ];
    const { now, scheduled, someday } = partitionViews(tasks, somedayId, TODAY);

    const nowIds = [...ids(now.overdue), ...ids(now.today), ...ids(now.noDate)];
    const scheduledIds = ids(scheduled);
    const somedayIds = ids(someday);

    // Exhaustive: every task appears somewhere.
    const seen = [...nowIds, ...scheduledIds, ...somedayIds].sort();
    expect(seen).toEqual(tasks.map((t) => t.id).sort());

    // Mutually exclusive: no id appears in more than one bucket.
    expect(new Set(seen).size).toBe(tasks.length);

    // Spot-check the interesting edges:
    // overdue/today go to Now regardless of list membership.
    expect(nowIds).toContain('overdue-park');
    expect(nowIds).toContain('today-park');
    // future goes to Scheduled regardless of list membership.
    expect(scheduledIds).toContain('future-park');
    // only dateless-in-someday-list lands in Someday.
    expect(somedayIds).toEqual(['dateless-park']);
    // dateless NOT in the someday list stays in Now's noDate.
    expect(ids(now.noDate)).toEqual(['dateless-other']);
  });

  it('overdue task in the someday list still goes to Now (not Someday)', () => {
    const { now, someday } = partitionViews(
      [task('od', '2026-09-01', 'park')],
      'park',
      TODAY,
    );
    expect(ids(now.overdue)).toEqual(['od']);
    expect(someday).toEqual([]);
  });

  it('future task in the someday list still goes to Scheduled (not Someday)', () => {
    const { scheduled, someday } = partitionViews(
      [task('fx', '2026-12-25', 'park')],
      'park',
      TODAY,
    );
    expect(ids(scheduled)).toEqual(['fx']);
    expect(someday).toEqual([]);
  });

  it('dateless task in the someday list goes to Someday', () => {
    const { now, someday } = partitionViews(
      [task('d', null, 'park')],
      'park',
      TODAY,
    );
    expect(now.noDate).toEqual([]);
    expect(ids(someday)).toEqual(['d']);
  });

  it('someday is empty and dateless tasks all fall to Now when somedayListId is null', () => {
    const { now, someday } = partitionViews(
      [task('a', null, 'park'), task('b', null, 'other')],
      null,
      TODAY,
    );
    expect(ids(now.noDate)).toEqual(['a', 'b']);
    expect(someday).toEqual([]);
  });

  it('orders the someday view by position ascending', () => {
    const { someday } = partitionViews(
      [
        task('c', null, 'park', 'needsAction', '00000000000000000003'),
        task('a', null, 'park', 'needsAction', '00000000000000000001'),
        task('b', null, 'park', 'needsAction', '00000000000000000002'),
      ],
      'park',
      TODAY,
    );
    expect(ids(someday)).toEqual(['a', 'b', 'c']);
  });

  it('orders scheduled by due asc then position', () => {
    const { scheduled } = partitionViews(
      [
        task('late', '2026-12-25', 'default', 'needsAction', '00000000000000000009'),
        task('early', '2026-10-01', 'default', 'needsAction', '00000000000000000005'),
        task('early2', '2026-10-01', 'default', 'needsAction', '00000000000000000000'),
      ],
      null,
      TODAY,
    );
    // Same due date → the lower position key wins; both precede the later date.
    expect(ids(scheduled)).toEqual(['early2', 'early', 'late']);
  });

  it('excludes completed tasks from all three views', () => {
    const { now, scheduled, someday } = partitionViews(
      [
        task('done-today', '2026-09-14', 'default', 'completed'),
        task('done-future', '2026-12-25', 'default', 'completed'),
        task('done-park', null, 'park', 'completed'),
      ],
      'park',
      TODAY,
    );
    expect(now.overdue).toEqual([]);
    expect(now.today).toEqual([]);
    expect(now.noDate).toEqual([]);
    expect(scheduled).toEqual([]);
    expect(someday).toEqual([]);
  });
});
