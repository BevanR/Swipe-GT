/**
 * Cheerful, varied empty-state copy for the task views.
 *
 * Pure data + a tiny picker so the UI can show a friendly, fresh message
 * (a big decorative emoji + a bold title + a muted subtitle) whenever the
 * Now or Someday view is empty. Inspired by Slack's warm, playful empty
 * states and Google Inbox's "sunshine" vibe.
 *
 * Offline-safe: emoji only, no external images or fonts.
 */

/** A single empty-state variant: a decorative emoji and two lines of copy. */
export interface EmptyMessage {
  /** Big decorative emoji (rendered aria-hidden). */
  emoji: string;
  /** Bold headline — the real, readable message. */
  title: string;
  /** Muted supporting line. */
  subtitle: string;
}

/** Upbeat variants for an empty Now view (inbox-zero / all-caught-up). */
export const NOW_EMPTY: readonly EmptyMessage[] = [
  {
    emoji: '🎉',
    title: 'All clear',
    subtitle: 'Nothing due — enjoy the breathing room.',
  },
  {
    emoji: '☀️',
    title: 'Inbox zero',
    subtitle: "You're all caught up.",
  },
  {
    emoji: '✅',
    title: 'Nothing on your plate',
    subtitle: 'Every task is handled. Nice work.',
  },
  {
    emoji: '🌴',
    title: 'Clear skies',
    subtitle: 'No tasks due today or overdue.',
  },
  {
    emoji: '🦥',
    title: 'Nothing urgent',
    subtitle: 'Go touch grass.',
  },
  {
    emoji: '🍃',
    title: 'Caught up',
    subtitle: 'Nothing needs you right now.',
  },
  {
    emoji: '🚀',
    title: 'You did it',
    subtitle: 'The list is empty. Take a moment.',
  },
  {
    emoji: '🧘',
    title: 'Calm and clear',
    subtitle: 'Nothing due — take a breath.',
  },
];

/** Variants for an empty Someday view (nothing parked). */
export const SOMEDAY_EMPTY: readonly EmptyMessage[] = [
  {
    emoji: '🗄️',
    title: 'Nothing parked',
    subtitle: 'Someday is wide open.',
  },
  {
    emoji: '💭',
    title: 'No maybes yet',
    subtitle: 'Park dateless tasks here from the snooze menu.',
  },
  {
    emoji: '🌱',
    title: 'Room to dream',
    subtitle: 'Ideas for later will live here.',
  },
  {
    emoji: '📦',
    title: 'The someday box is empty',
    subtitle: 'Nothing set aside for later.',
  },
  {
    emoji: '🌤️',
    title: 'Someday is clear',
    subtitle: 'No parked tasks waiting.',
  },
];

/**
 * Pick one variant from a set.
 *
 * With no `seed`, returns a random entry (nice per view-mount freshness in the
 * UI). With a numeric `seed`, returns a deterministic entry (`set[seed % len]`,
 * safe for any non-negative integer) — used by tests and any caller that wants
 * stable output.
 */
export function pickEmpty(
  set: readonly EmptyMessage[],
  seed?: number,
): EmptyMessage {
  if (set.length === 0) {
    throw new Error('pickEmpty: empty message set');
  }
  const index =
    seed === undefined
      ? Math.floor(Math.random() * set.length)
      : ((Math.trunc(seed) % set.length) + set.length) % set.length;
  return set[index]!;
}
