// Pure, DOM-free helpers for the desktop keyboard shortcuts.
//
// `keyToAction` maps a raw `KeyboardEvent.key` (plus modifier flags) to a
// semantic action name; `isTypingElement` is the pure core of the
// "ignore shortcuts while the user is typing" guard. The DOM wiring (composed
// path traversal, focus, scrollIntoView, calling card methods) lives in the
// components and is covered by the build / smoke gates.

/** The semantic keyboard actions the list screen understands. */
export type KeyAction =
  | 'add'
  | 'search'
  | 'view-now'
  | 'view-scheduled'
  | 'view-someday'
  | 'view-prev'
  | 'view-next'
  | 'next'
  | 'prev'
  | 'edit'
  | 'complete'
  | 'snooze'
  | 'undo'
  | 'escape'
  | 'help';

/** Modifier flags read off the KeyboardEvent. */
export interface KeyModifiers {
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/**
 * Map a `KeyboardEvent.key` + modifiers to a {@link KeyAction}, or `null` when
 * the key is not a shortcut.
 *
 * Design notes:
 *  - Any Ctrl / Alt / Meta combo is left alone (returns `null`) so native and
 *    OS shortcuts keep working; only Shift is honoured, and only for `?`.
 *  - `?` (Shift+/) opens the help overlay; a bare `/` opens search.
 *  - Letters are matched case-insensitively but ONLY without Shift, so a
 *    capital letter never fires a shortcut.
 *  - `Escape` is always mapped; the caller decides it is the one action allowed
 *    to run while the user is typing.
 */
export function keyToAction(key: string, mods: KeyModifiers = {}): KeyAction | null {
  // Never intercept OS / browser combos.
  if (mods.ctrl || mods.alt || mods.meta) return null;

  // Keys that stand alone regardless of Shift.
  switch (key) {
    case 'Escape':
      return 'escape';
    case '?':
      return 'help';
    case '/':
      return 'search';
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'prev';
    case 'ArrowLeft':
      return 'view-prev';
    case 'ArrowRight':
      return 'view-next';
    case 'Enter':
      return 'edit';
  }

  // Remaining shortcuts are single letters/digits; Shift disqualifies them so
  // uppercase input never triggers an action.
  if (mods.shift) return null;

  switch (key.toLowerCase()) {
    case 'a':
      return 'add';
    case '1':
      return 'view-now';
    case '2':
      return 'view-scheduled';
    case '3':
      return 'view-someday';
    case 'j':
      return 'next';
    case 'k':
      return 'prev';
    case 'e':
      return 'edit';
    case 'c':
    case 'x':
      return 'complete';
    case 's':
      return 'snooze';
    case 'u':
    case 'z':
      return 'undo';
    default:
      return null;
  }
}

/**
 * True when `el` is a text-entry control that should swallow shortcuts: an
 * `<input>`, `<textarea>`, `<select>`, or a contentEditable element. Pure core
 * of the typing-context guard; the caller walks the event's composed path (to
 * see through shadow DOM) and calls this on each node.
 */
export function isTypingElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  const attr = el.getAttribute?.('contenteditable');
  if (attr != null && attr !== 'false') return true;
  return false;
}
