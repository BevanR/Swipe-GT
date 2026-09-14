import { describe, expect, it, vi } from 'vitest';
import { UNDO_WINDOW_MS, UndoTimer } from './undo';

/**
 * A controllable fake for the injected timer pair: `start()` records the
 * scheduled callback so a test can fire it (`fire()`) on demand, and tracks
 * clears, all without real timers.
 */
function makeFakeClock() {
  let pending: { id: number; fn: () => void; ms: number } | null = null;
  let nextId = 1;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      pending = { id, fn, ms };
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (id: ReturnType<typeof setTimeout>) => {
      if (pending && pending.id === (id as unknown as number)) pending = null;
    },
    fire: () => {
      const p = pending;
      pending = null;
      p?.fn();
    },
    get scheduledMs() {
      return pending?.ms ?? null;
    },
  };
}

describe('UndoTimer', () => {
  it('starts a window using the configured delay and reports pending', () => {
    const clock = makeFakeClock();
    const t = new UndoTimer(UNDO_WINDOW_MS, clock.setTimer, clock.clearTimer);
    expect(t.pending).toBe(false);
    const started = t.start(() => {});
    expect(started).toBe(true);
    expect(t.pending).toBe(true);
    expect(clock.scheduledMs).toBe(UNDO_WINDOW_MS);
  });

  it('fires onElapse exactly once when the window completes, then is no longer pending', () => {
    const clock = makeFakeClock();
    const onElapse = vi.fn();
    const t = new UndoTimer(1000, clock.setTimer, clock.clearTimer);
    t.start(onElapse);
    clock.fire();
    expect(onElapse).toHaveBeenCalledTimes(1);
    expect(t.pending).toBe(false);
  });

  it('cancel() stops a pending window WITHOUT firing onElapse and returns true', () => {
    const clock = makeFakeClock();
    const onElapse = vi.fn();
    const t = new UndoTimer(1000, clock.setTimer, clock.clearTimer);
    t.start(onElapse);
    const wasPending = t.cancel();
    expect(wasPending).toBe(true);
    expect(t.pending).toBe(false);
    // Even if a stale callback somehow ran, cancel cleared it.
    clock.fire();
    expect(onElapse).not.toHaveBeenCalled();
  });

  it('cancel() returns false when nothing is pending (nothing to flush)', () => {
    const clock = makeFakeClock();
    const t = new UndoTimer(1000, clock.setTimer, clock.clearTimer);
    expect(t.cancel()).toBe(false);
  });

  it('ignores a second start() while pending so timers cannot stack', () => {
    const clock = makeFakeClock();
    const first = vi.fn();
    const second = vi.fn();
    const t = new UndoTimer(1000, clock.setTimer, clock.clearTimer);
    expect(t.start(first)).toBe(true);
    expect(t.start(second)).toBe(false);
    clock.fire();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('is restartable after cancel (Undo then complete again)', () => {
    const clock = makeFakeClock();
    const again = vi.fn();
    const t = new UndoTimer(1000, clock.setTimer, clock.clearTimer);
    t.start(() => {});
    t.cancel();
    expect(t.start(again)).toBe(true);
    clock.fire();
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('defaults to the shared UNDO_WINDOW_MS constant', () => {
    expect(UNDO_WINDOW_MS).toBe(2000);
  });
});
