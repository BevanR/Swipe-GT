// Pure, DOM-free helpers for the client-side task search.
//
// Search runs entirely over the already-fetched task set (all non-completed
// tasks on included lists). It is a case-insensitive substring match on a
// task's `title`, and on its `notes` when present. The query itself is
// transient UI state and is never persisted.

import type { Task } from '../types';

/**
 * True when `task` matches the search query `q` (case-insensitive substring on
 * title, and on notes when present). `q` is trimmed first; an empty query is
 * treated as "no filter" and matches everything, so callers can pass the raw
 * query through without a guard.
 */
export function matchesQuery(task: Task, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true; // empty query → no filter
  if (task.title.toLowerCase().includes(needle)) return true;
  if (task.notes != null && task.notes.toLowerCase().includes(needle)) {
    return true;
  }
  return false;
}

/**
 * Filter `tasks` to those matching `q`. An empty (or whitespace-only) query
 * returns the input unchanged (no filter). Order is preserved.
 */
export function searchTasks(tasks: Task[], q: string): Task[] {
  if (q.trim() === '') return tasks;
  return tasks.filter((t) => matchesQuery(t, q));
}

/** The two search result sections shown when the query is non-empty. */
export interface SearchSections {
  /** Matches within the current view, kept in that view's order. */
  inView: Task[];
  /**
   * Matches from the full fetched set that are NOT in {@link inView} (deduped
   * by id), ordered by due date ascending with no-date tasks last.
   */
  other: Task[];
}

/**
 * Partition search matches into the two rendered sections.
 *
 * @param viewTasks Tasks of the currently-selected view, already in that view's
 *   display order (overdue → today → no-date for `default`; due-ascending for
 *   `future`). These become section 1 ("In this view"), filtered to matches.
 * @param allTasks  The full fetched task set (all views). Matches here that are
 *   not already in section 1 become section 2 ("Other matches").
 * @param q The search query. An empty/whitespace query yields two empty
 *   sections (the caller renders the normal view instead).
 */
export function partitionSearch(
  viewTasks: Task[],
  allTasks: Task[],
  q: string,
): SearchSections {
  if (q.trim() === '') return { inView: [], other: [] };

  const inView = viewTasks.filter((t) => matchesQuery(t, q));
  const inViewIds = new Set(inView.map((t) => t.id));

  const other = allTasks
    .filter((t) => matchesQuery(t, q) && !inViewIds.has(t.id))
    .sort(compareDueAsc);

  return { inView, other };
}

/** Order by due date ascending; tasks with no due date sort last. */
function compareDueAsc(a: Task, b: Task): number {
  const da = a.due != null ? a.due.slice(0, 10) : null;
  const db = b.due != null ? b.due.slice(0, 10) : null;
  if (da === null && db === null) return 0;
  if (da === null) return 1; // no-date last
  if (db === null) return -1;
  if (da !== db) return da < db ? -1 : 1;
  // Stable-ish tie-break on Google's manual-order key.
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return 0;
}
