import { describe, expect, it } from 'vitest';
import {
  COMMIT_RATIO,
  FLICK_VELOCITY,
  decideSwipe,
  isHorizontalSwipe,
  isVerticalScroll,
} from './swipe';

describe('decideSwipe', () => {
  const WIDTH = 300;

  it('does not commit a small, slow drag', () => {
    const d = decideSwipe(20, WIDTH, 0.01);
    expect(d.commit).toBe(false);
    expect(d.direction).toBe('right');
  });

  it('commits when dragged past the width ratio (right)', () => {
    const dx = WIDTH * COMMIT_RATIO + 1;
    const d = decideSwipe(dx, WIDTH, 0);
    expect(d).toEqual({ commit: true, direction: 'right' });
  });

  it('commits when dragged past the width ratio (left)', () => {
    const dx = -(WIDTH * COMMIT_RATIO + 1);
    const d = decideSwipe(dx, WIDTH, 0);
    expect(d).toEqual({ commit: true, direction: 'left' });
  });

  it('commits a short but fast flick in the same direction', () => {
    const d = decideSwipe(-10, WIDTH, -(FLICK_VELOCITY + 0.1));
    expect(d.commit).toBe(true);
    expect(d.direction).toBe('left');
  });

  it('ignores a fast velocity pointing opposite the drag', () => {
    const d = decideSwipe(10, WIDTH, -(FLICK_VELOCITY + 0.1));
    expect(d.commit).toBe(false);
  });

  it('reports no direction for a zero delta', () => {
    expect(decideSwipe(0, WIDTH, 0)).toEqual({ commit: false, direction: null });
  });
});

describe('axis locking', () => {
  it('treats a clearly horizontal move as a swipe', () => {
    expect(isHorizontalSwipe(30, 5)).toBe(true);
    expect(isVerticalScroll(30, 5)).toBe(false);
  });

  it('treats a clearly vertical move as a scroll', () => {
    expect(isVerticalScroll(4, 30)).toBe(true);
    expect(isHorizontalSwipe(4, 30)).toBe(false);
  });

  it('ignores tiny movements inside the deadzone', () => {
    expect(isHorizontalSwipe(5, 1)).toBe(false);
    expect(isVerticalScroll(1, 5)).toBe(false);
  });
});
