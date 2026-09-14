/**
 * A tiny hash-based router for the PWA. This app ships as a static GitHub Pages
 * site served under the base `/g-tasks/`, so it MUST use hash routing (never
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
export type NavTarget = 'list' | 'add';

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
      if (parts.length >= 3 && parts[1] && parts[2]) {
        return { name: 'edit', params: { listId: parts[1], taskId: parts[2] } };
      }
      return { name: 'list', params: {} };
    default:
      return { name: 'list', params: {} };
  }
}

/** Build the hash string for a navigable target. */
export function hashFor(target: NavTarget): string {
  return target === 'add' ? '#/add' : '#/';
}

/**
 * Tracks whether the last navigation was made from within the app, so {@link
 * back} can safely use history back (and land on the previous in-app screen)
 * rather than risk stepping outside the app on a deep-linked entry.
 */
let navigatedWithinApp = false;

/** Navigate to a route by setting the location hash (pushes a history entry). */
export function navigate(target: NavTarget): void {
  navigatedWithinApp = true;
  if (typeof location !== 'undefined') {
    location.hash = hashFor(target);
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
