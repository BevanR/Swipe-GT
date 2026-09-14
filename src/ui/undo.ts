// The "undo window" timer for a completed task, kept free of DOM so it can be
// unit-tested without a real component. It manages a single one-shot countdown
// and the guards around it (no double-start, cancel-only-when-pending), leaving
// the visual/animation work to the card.
//
// The card starts a window when a Complete is committed. Exactly one of three
// things then happens:
//   - the window elapses  -> `onElapse` fires (the card collapses + dispatches),
//   - the user taps Undo   -> `cancel()` stops it WITHOUT firing `onElapse`,
//   - the card unmounts     -> the card calls `cancel()` and flushes itself
//     (dispatching immediately so a pending completion is never lost).

/** How long the Undo affordance stays before the completion commits (ms). */
export const UNDO_WINDOW_MS = 2000;

/**
 * A restartable, single-shot countdown. The `setTimer`/`clearTimer` pair is
 * injectable so tests can drive it deterministically without real timers.
 */
export class UndoTimer {
  private id: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly delayMs: number = UNDO_WINDOW_MS,
    private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (
      fn,
      ms,
    ) => setTimeout(fn, ms),
    private readonly clearTimer: (id: ReturnType<typeof setTimeout>) => void = (id) =>
      clearTimeout(id),
  ) {}

  /** True while a window is counting down. */
  get pending(): boolean {
    return this.id !== null;
  }

  /**
   * Begin the countdown. `onElapse` fires exactly once when the window completes
   * naturally. Ignored (returns `false`) if a window is already pending, so a
   * repeated commit can't stack timers.
   */
  start(onElapse: () => void): boolean {
    if (this.id !== null) return false;
    this.id = this.setTimer(() => {
      this.id = null;
      onElapse();
    }, this.delayMs);
    return true;
  }

  /**
   * Stop a pending countdown WITHOUT firing `onElapse`. Returns `true` if a
   * window was actually pending — the caller uses that both to spring the card
   * back (Undo tapped) and to decide it must flush (unmount while pending).
   */
  cancel(): boolean {
    if (this.id === null) return false;
    this.clearTimer(this.id);
    this.id = null;
    return true;
  }
}
