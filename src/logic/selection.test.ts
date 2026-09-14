import { describe, expect, it } from 'vitest';
import { nextIndex, nextId, resolveActingId } from './selection';

const LIST = ['a', 'b', 'c', 'd'];

describe('nextIndex', () => {
  it('steps forward and backward within bounds', () => {
    expect(nextIndex(LIST, 'a', 1)).toBe(1);
    expect(nextIndex(LIST, 'b', 1)).toBe(2);
    expect(nextIndex(LIST, 'c', -1)).toBe(1);
  });

  it('clamps at the end (no wrap)', () => {
    expect(nextIndex(LIST, 'd', 1)).toBe(3);
    expect(nextIndex(LIST, 'd', 5)).toBe(3);
  });

  it('clamps at the start (no wrap)', () => {
    expect(nextIndex(LIST, 'a', -1)).toBe(0);
    expect(nextIndex(LIST, 'a', -5)).toBe(0);
  });

  it('returns -1 for an empty list', () => {
    expect(nextIndex([], 'a', 1)).toBe(-1);
    expect(nextIndex([], null, -1)).toBe(-1);
  });

  it('lands on the first task when nothing is selected', () => {
    expect(nextIndex(LIST, null, 1)).toBe(0);
    expect(nextIndex(LIST, null, -1)).toBe(0);
  });

  it('lands on the first task when the current id is unknown', () => {
    expect(nextIndex(LIST, 'gone', 1)).toBe(0);
    expect(nextIndex(LIST, 'gone', -1)).toBe(0);
  });
});

describe('nextId', () => {
  it('maps the resolved index back to an id', () => {
    expect(nextId(LIST, 'a', 1)).toBe('b');
    expect(nextId(LIST, 'd', 1)).toBe('d'); // clamped
    expect(nextId(LIST, null, 1)).toBe('a'); // none selected → first
    expect(nextId(LIST, 'gone', -1)).toBe('a'); // unknown → first
  });

  it('returns null for an empty list', () => {
    expect(nextId([], 'a', 1)).toBeNull();
  });
});

describe('resolveActingId', () => {
  it('keeps a valid current selection', () => {
    expect(resolveActingId(LIST, 'c')).toBe('c');
  });

  it('falls back to the first task when nothing / an unknown id is selected', () => {
    expect(resolveActingId(LIST, null)).toBe('a');
    expect(resolveActingId(LIST, 'gone')).toBe('a');
  });

  it('returns null for an empty list', () => {
    expect(resolveActingId([], 'a')).toBeNull();
    expect(resolveActingId([], null)).toBeNull();
  });
});
