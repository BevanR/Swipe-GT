// App configuration read from Vite env vars at build time.

/**
 * Google OAuth 2.0 Web client ID, injected at build time from the
 * `VITE_GOOGLE_CLIENT_ID` env var. See README "Google OAuth setup".
 * Ends with `.apps.googleusercontent.com`.
 */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID;

/**
 * The single OAuth scope this app requests. Read/write access to the user's
 * Google Tasks. We deliberately request nothing else.
 */
export const OAUTH_SCOPE = 'https://www.googleapis.com/auth/tasks';
