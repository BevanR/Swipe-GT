// Pure swipe-gesture math, kept free of DOM so it can be unit-tested in jsdom
// (which has no real layout). The card component feeds it deltas and dimensions.

export type SwipeDirection = 'left' | 'right';

export interface SwipeDecision {
  /** True when the gesture should commit its action rather than spring back. */
  commit: boolean;
  /** Direction the card was dragged, or null when there was no movement. */
  direction: SwipeDirection | null;
}

/** Fraction of the card width past which a slow drag commits. */
export const COMMIT_RATIO = 0.35;
/** Absolute px/ms flick speed past which even a short drag commits. */
export const FLICK_VELOCITY = 0.5;
/** Deadzone (px) before we lock a gesture to an axis. */
export const AXIS_LOCK_PX = 8;

/**
 * Decide whether a horizontal drag commits.
 *
 * @param dx        Horizontal delta in px (positive = dragged right).
 * @param width     Card width in px.
 * @param velocity  Instantaneous px/ms at release (signed like dx).
 */
export function decideSwipe(
  dx: number,
  width: number,
  velocity: number,
  commitRatio: number = COMMIT_RATIO,
  flickVelocity: number = FLICK_VELOCITY,
): SwipeDecision {
  if (dx === 0) return { commit: false, direction: null };
  const direction: SwipeDirection = dx > 0 ? 'right' : 'left';
  const past = width > 0 && Math.abs(dx) >= width * commitRatio;
  const flick =
    Math.abs(velocity) >= flickVelocity && Math.sign(velocity) === Math.sign(dx);
  return { commit: past || flick, direction };
}

/**
 * True when a pointer movement should be treated as a horizontal swipe rather
 * than a vertical scroll. Requires clearing the axis-lock deadzone.
 */
export function isHorizontalSwipe(dx: number, dy: number, lockPx: number = AXIS_LOCK_PX): boolean {
  return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > lockPx;
}

/** True when the movement is a decisive vertical scroll (should abort a swipe). */
export function isVerticalScroll(dx: number, dy: number, lockPx: number = AXIS_LOCK_PX): boolean {
  return Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > lockPx;
}
