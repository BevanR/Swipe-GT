/**
 * A tiny hash-based router for the PWA. This app ships as a static GitHub Pages
 * site served under the base `/Swipe-GT/`, so it MUST use hash routing (never
 * history/pushState paths, which would 404 on reload).
 *
 * The route model is a small discriminated union so it can grow: today it
 * supports the main list (`#/`) and the Add Task screen (`#/add`); it is shaped
 * to accept a future edit route (`#/edit/<listId>/<taskId>`) without changing
 * any call site.
 */

/** A parsed route. Discriminated on `name`; `params` carries route arguments. */
export type Route =
  | { name: 'list'; params: Record<string, never> }
  | { name: 'add'; params: Record<string, never> }
  | { name: 'edit'; params: { listId: string; taskId: string } };

/** The route names that can be navigated to programmatically today. */
export type NavTarget = 'list' | 'add' | 'edit';

/** Params required to build/navigate to an `edit` route. */
export interface EditParams {
  listId: string;
  taskId: string;
}

/**
 * Parse a raw `location.hash` (e.g. `#/add`, `#/`, ``) into a {@link Route}.
 *
 * Unknown or empty hashes fall back to the main list, so a stray/legacy hash
 * never leaves the app on a blank screen. The `edit` branch is parsed here (even
 * though nothing dispatches it yet) so a later feature can render it by adding a
 * single case to the shell — the router already understands the shape.
 */
export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = clean === '' ? [] : clean.split('/');
  const head = parts[0];

  switch (head) {
    case 'add':
      return { name: 'add', params: {} };
    case 'edit':
      // #/edit/<listId>/<taskId> — both segments required; otherwise fall back.
      // Segments are percent-decoded so an id with reserved chars (e.g. the
      // built-in `@default` list id, encoded to `%40default` by hashFor) round
      // trips back to its original form for state lookups.
      if (parts.length >= 3 && parts[1] && parts[2]) {
        return {
          name: 'edit',
          params: {
            listId: safeDecode(parts[1]),
            taskId: safeDecode(parts[2]),
          },
        };
      }
      return { name: 'list', params: {} };
    default:
      return { name: 'list', params: {} };
  }
}

/** Decode a hash segment, tolerating a malformed `%` sequence. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Build the hash string for a navigable target. The `edit` target requires
 * {@link EditParams}; its ids are percent-encoded so reserved characters survive
 * the round trip through {@link parseHash}.
 */
export function hashFor(target: NavTarget, params?: EditParams): string {
  if (target === 'add') return '#/add';
  if (target === 'edit' && params) {
    return `#/edit/${encodeURIComponent(params.listId)}/${encodeURIComponent(params.taskId)}`;
  }
  return '#/';
}

/**
 * Tracks whether the last navigation was made from within the app, so {@link
 * back} can safely use history back (and land on the previous in-app screen)
 * rather than risk stepping outside the app on a deep-linked entry.
 */
let navigatedWithinApp = false;

/** Navigate to a route by setting the location hash (pushes a history entry). */
export function navigate(target: NavTarget, params?: EditParams): void {
  navigatedWithinApp = true;
  if (typeof location !== 'undefined') {
    location.hash = hashFor(target, params);
  }
}

/**
 * Return to the main list. Prefers a real history-back (so the browser's
 * forward/back and the in-app Back agree) when we navigated here from within the
 * app; otherwise (a deep link straight to `#/add`) it just sets the hash to
 * `#/` so we never leave the app.
 */
export function back(): void {
  if (
    navigatedWithinApp &&
    typeof window !== 'undefined' &&
    window.history.length > 1
  ) {
    navigatedWithinApp = false;
    window.history.back();
  } else if (typeof location !== 'undefined') {
    location.hash = hashFor('list');
  }
}

/** The current route parsed from `location.hash`. */
export function currentRoute(): Route {
  return parseHash(typeof location !== 'undefined' ? location.hash : '');
}
