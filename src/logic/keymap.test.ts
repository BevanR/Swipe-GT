import { describe, expect, it } from 'vitest';
import { keyToAction, isTypingElement } from './keymap';

describe('keyToAction', () => {
  it('maps the primary letter shortcuts', () => {
    expect(keyToAction('a')).toBe('add');
    expect(keyToAction('e')).toBe('edit');
    expect(keyToAction('c')).toBe('complete');
    expect(keyToAction('x')).toBe('complete');
    expect(keyToAction('s')).toBe('snooze');
    expect(keyToAction('u')).toBe('undo');
    expect(keyToAction('z')).toBe('undo');
    expect(keyToAction('j')).toBe('next');
    expect(keyToAction('k')).toBe('prev');
  });

  it('maps left/right arrows to view prev/next', () => {
    expect(keyToAction('ArrowLeft')).toBe('view-prev');
    expect(keyToAction('ArrowRight')).toBe('view-next');
  });

  it('is case-insensitive for letters only without Shift', () => {
    expect(keyToAction('A')).toBe('add'); // key already lowercased, no shift flag
    expect(keyToAction('a', { shift: true })).toBeNull(); // Shift disqualifies
    expect(keyToAction('J', { shift: true })).toBeNull();
  });

  it('maps the digit view switches', () => {
    expect(keyToAction('1')).toBe('view-now');
    expect(keyToAction('2')).toBe('view-scheduled');
    expect(keyToAction('3')).toBe('view-someday');
  });

  it('maps the arrows to next/prev', () => {
    expect(keyToAction('ArrowDown')).toBe('next');
    expect(keyToAction('ArrowUp')).toBe('prev');
  });

  it('maps Enter to edit', () => {
    expect(keyToAction('Enter')).toBe('edit');
  });

  it('distinguishes / (search) from ? (help)', () => {
    expect(keyToAction('/')).toBe('search');
    // "?" arrives as its own key even though Shift is physically held.
    expect(keyToAction('?', { shift: true })).toBe('help');
    expect(keyToAction('?')).toBe('help');
  });

  it('always maps Escape', () => {
    expect(keyToAction('Escape')).toBe('escape');
    expect(keyToAction('Escape', { shift: true })).toBe('escape');
  });

  it('ignores Ctrl / Alt / Meta combos so native shortcuts survive', () => {
    expect(keyToAction('a', { ctrl: true })).toBeNull();
    expect(keyToAction('a', { meta: true })).toBeNull();
    expect(keyToAction('s', { meta: true })).toBeNull(); // e.g. Cmd+S save
    expect(keyToAction('ArrowDown', { alt: true })).toBeNull();
  });

  it('returns null for unmapped keys', () => {
    expect(keyToAction('q')).toBeNull();
    expect(keyToAction('9')).toBeNull();
    expect(keyToAction('F5')).toBeNull();
  });
});

describe('isTypingElement', () => {
  it('is true for input, textarea and select', () => {
    expect(isTypingElement(document.createElement('input'))).toBe(true);
    expect(isTypingElement(document.createElement('textarea'))).toBe(true);
    expect(isTypingElement(document.createElement('select'))).toBe(true);
  });

  it('is true for a contentEditable element', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    expect(isTypingElement(el)).toBe(true);
  });

  it('is false for contenteditable="false"', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'false');
    expect(isTypingElement(el)).toBe(false);
  });

  it('is false for ordinary elements and null', () => {
    expect(isTypingElement(document.createElement('div'))).toBe(false);
    expect(isTypingElement(document.createElement('button'))).toBe(false);
    expect(isTypingElement(null)).toBe(false);
  });
});
