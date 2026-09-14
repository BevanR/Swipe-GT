import { describe, expect, it } from 'vitest';
import {
  NOW_EMPTY,
  SOMEDAY_EMPTY,
  pickEmpty,
  type EmptyMessage,
} from './emptyMessages';

const SETS: Array<readonly EmptyMessage[]> = [NOW_EMPTY, SOMEDAY_EMPTY];

describe('empty message sets', () => {
  it('are non-empty', () => {
    expect(NOW_EMPTY.length).toBeGreaterThan(0);
    expect(SOMEDAY_EMPTY.length).toBeGreaterThan(0);
  });

  it('have a non-empty emoji, title and subtitle for every entry', () => {
    for (const set of SETS) {
      for (const entry of set) {
        expect(entry.emoji.trim()).not.toBe('');
        expect(entry.title.trim()).not.toBe('');
        expect(entry.subtitle.trim()).not.toBe('');
      }
    }
  });

  it('includes a sunshine variant in the Now set', () => {
    expect(NOW_EMPTY.some((e) => e.emoji === '☀️')).toBe(true);
  });
});

describe('pickEmpty', () => {
  it('with a seed is deterministic', () => {
    for (const set of SETS) {
      for (let seed = 0; seed < set.length * 3; seed++) {
        expect(pickEmpty(set, seed)).toBe(pickEmpty(set, seed));
      }
    }
  });

  it('maps a seed to the entry at seed % length', () => {
    for (const set of SETS) {
      for (let seed = 0; seed < set.length * 2 + 1; seed++) {
        expect(pickEmpty(set, seed)).toBe(set[seed % set.length]);
      }
    }
  });

  it('handles negative seeds without going out of range', () => {
    for (const set of SETS) {
      for (const seed of [-1, -2, -set.length, -set.length - 1]) {
        expect(set).toContain(pickEmpty(set, seed));
      }
    }
  });

  it('random pick (no seed) always returns an in-set entry', () => {
    for (const set of SETS) {
      for (let i = 0; i < 50; i++) {
        expect(set).toContain(pickEmpty(set));
      }
    }
  });

  it('throws on an empty set', () => {
    expect(() => pickEmpty([])).toThrow();
  });
});
