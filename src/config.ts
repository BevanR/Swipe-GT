// App configuration read from Vite env vars at build time.

/**
 * Google OAuth 2.0 Web client ID for this app.
 *
 * A web OAuth client ID is a public identifier, not a secret — it ships in the
 * browser bundle by design, so the project's real ID is committed here as the
 * default. It can be overridden at build time via the `VITE_GOOGLE_CLIENT_ID`
 * env var (e.g. to point a fork at a different Google Cloud project). There is
 * no client secret anywhere in this app; the GIS token flow does not use one.
 * See README "Google OAuth setup". Ends with `.apps.googleusercontent.com`.
 */
const DEFAULT_GOOGLE_CLIENT_ID =
  '191139856358-56c5keetsrbu3cpqpd94mv8u738nk40t.apps.googleusercontent.com';

export const GOOGLE_CLIENT_ID: string =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;

/**
 * The single OAuth scope this app requests. Read/write access to the user's
 * Google Tasks. We deliberately request nothing else.
 */
export const OAUTH_SCOPE = 'https://www.googleapis.com/auth/tasks';
