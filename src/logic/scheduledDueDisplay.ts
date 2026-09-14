import { formatFullDate } from './dueLabel';
import type { DueDisplay } from '../ui/task-card';

/**
 * Decide how a Scheduled-view card should show its due date, given the bucket it
 * lives in. The bucket header already states the day for the near buckets, so
 * repeating the per-card date there is redundant:
 *
 *  - `tomorrow` and the weekday buckets (`dow-*`) → `'hidden'` (the header
 *    already names the day).
 *  - the range buckets (`next-week`, `later-this-month`, `next-month`, `later`)
 *    → an absolute friendly date like `Tuesday 15 Sep` (from `formatFullDate`),
 *    since their headers only give a range.
 *
 * A dateless task (should not occur in Scheduled) resolves to `'hidden'`.
 *
 * @param bucketKey The `ScheduledGroup.key` the task is rendered under.
 * @param due       The task's due date ('YYYY-MM-DD') or null.
 * @param today     Reference for the "same year" check; defaults to `new Date()`.
 */
export function scheduledDueDisplay(
  bucketKey: string,
  due: string | null,
  today: Date = new Date(),
): DueDisplay {
  if (bucketKey === 'tomorrow' || bucketKey.startsWith('dow-')) return 'hidden';
  if (due == null) return 'hidden';
  return formatFullDate(due, today);
}
