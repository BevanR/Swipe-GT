// Shared constants for broker-mode auth. The endpoints are ABSOLUTE root paths:
// broker mode is only used on the single-origin Cloudflare deployment, where the
// app and the Worker API share the origin and the app is served at `/`. (The GIS
// build stays path-portable and never imports these.)

/** Full-page redirect target that starts the server-side code flow. */
export const LOGIN_PATH = '/auth/login';
/** POST here to delete the server session (logout). */
export const LOGOUT_PATH = '/auth/logout';
/** Fetched to obtain a currently-valid access token (200) or reconnect (401). */
export const TOKEN_PATH = '/api/token';

/**
 * Name of the readable (non-httpOnly) "connected" hint cookie the broker sets
 * alongside the httpOnly session cookie. It carries no secret — only a boolean
 * signal the SPA can read to know a session exists.
 */
export const CONNECTED_HINT_COOKIE = 'gt_connected';
