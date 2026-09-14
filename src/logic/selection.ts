// Pure, DOM-free helpers for keyboard task selection.
//
// The list view keeps a single `selectedTaskId`. The current view renders an
// ordered, flat sequence of visible task ids; these helpers move the selection
// up/down that sequence with clamping (no wrap) and resolve which task a
// task-acting shortcut should target when nothing is selected yet.

/**
 * The index the selection should move to when stepping `delta` from the task
 * currently identified by `currentId` within the ordered `list` of visible ids.
 *
 * Rules:
 *  - Empty list → `-1` (nothing selectable).
 *  - `currentId` null or not found in `list` → `0` (the first task): a fresh
 *    j/k/next/prev with no valid selection lands on the first visible task.
 *  - Otherwise `currentIndex + delta`, CLAMPED to `[0, list.length - 1]` so
 *    moving past either end stays on the end task (no wrap-around).
 */
export function nextIndex(
  list: readonly string[],
  currentId: string | null,
  delta: number,
): number {
  if (list.length === 0) return -1;
  const cur = currentId == null ? -1 : list.indexOf(currentId);
  if (cur === -1) return 0; // no / unknown selection → first
  const next = cur + delta;
  return Math.max(0, Math.min(list.length - 1, next));
}

/**
 * The id the selection should move to when stepping `delta` from `currentId`,
 * or `null` when the list is empty. Convenience wrapper over {@link nextIndex}
 * that maps the resolved index back to an id.
 */
export function nextId(
  list: readonly string[],
  currentId: string | null,
  delta: number,
): string | null {
  const i = nextIndex(list, currentId, delta);
  return i === -1 ? null : list[i]!;
}

/**
 * The id a task-acting shortcut (edit/complete/snooze) should target: the
 * current selection when it is still a member of `list`, otherwise the first
 * visible id (so an unselected list acts on its first task). `null` only when
 * the list is empty.
 */
export function resolveActingId(
  list: readonly string[],
  currentId: string | null,
): string | null {
  if (list.length === 0) return null;
  if (currentId != null && list.includes(currentId)) return currentId;
  return list[0]!;
}
