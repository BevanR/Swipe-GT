// Auth-broker request handlers. Each takes the incoming Request + Env and returns
// a Response. They are written as thin orchestration over the pure helpers in
// crypto.ts / cookies.ts / oauth.ts so the security-critical logic is unit-tested
// directly, and the handlers themselves are tested with an in-memory KV + mocked
// `fetch`.
//
// Same-origin design: the SPA and these endpoints share one origin (the Worker
// serves both), so the session cookie is first-party and there is NO CORS. The
// session cookie is httpOnly (page JS cannot read the session id); the SPA only
// ever receives short-lived ACCESS tokens from /api/token.

import {
  generateCodeVerifier,
  codeChallengeS256,
  randomToken,
  sign,
  unsign,
  timingSafeEqual,
} from './crypto';
import {
  CONNECTED_HINT_COOKIE,
  OAUTH_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  parseCookies,
  serializeCookie,
} from './cookies';
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  TokenEndpointError,
} from './oauth';
import type { Env, SessionRecord } from './types';

/** How long a broker session (refresh token) lives in KV before auto-GC. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 400; // ~400 days
/** How long the in-flight PKCE/state stash cookie lives. */
const OAUTH_STASH_TTL_SECONDS = 600; // 10 minutes
/** Refresh the access token when it has less than this left (ms). */
const ACCESS_TOKEN_SKEW_MS = 60_000;

const KV_PREFIX = 'session:';

/** The public origin of this deployment (explicit var, else the request origin). */
export function appOrigin(request: Request, env: Env): string {
  return env.APP_ORIGIN && env.APP_ORIGIN.length > 0
    ? env.APP_ORIGIN
    : new URL(request.url).origin;
}

/** The OAuth redirect URI registered in Google: `<origin>/auth/callback`. */
export function redirectUri(request: Request, env: Env): string {
  return `${appOrigin(request, env)}/auth/callback`;
}

/** Whether to set the Secure cookie attribute (true on https origins). */
function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

/** Standard attributes for the httpOnly session/oauth cookies. */
function sessionCookieOpts(request: Request, maxAge: number) {
  return {
    httpOnly: true,
    secure: isSecure(request),
    sameSite: 'Lax' as const,
    path: '/',
    maxAge,
  };
}

/** Attributes for the readable "connected" hint cookie (NOT httpOnly). */
function hintCookieOpts(request: Request, maxAge: number) {
  return {
    httpOnly: false,
    secure: isSecure(request),
    sameSite: 'Lax' as const,
    path: '/',
    maxAge,
  };
}

function jsonResponse(obj: unknown, status: number, cookies: string[] = []): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(obj), { status, headers });
}

function redirectResponse(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

/**
 * GET /auth/login — begin the code flow. Generate a PKCE verifier + CSRF state,
 * stash them in a short-lived signed httpOnly cookie, and redirect to Google's
 * consent screen.
 */
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const verifier = generateCodeVerifier();
  const challenge = await codeChallengeS256(verifier);
  const state = randomToken(16);

  const stash = await sign(JSON.stringify({ state, verifier }), env.COOKIE_SIGNING_KEY);
  const authUrl = buildAuthorizationUrl({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: redirectUri(request, env),
    scope: env.OAUTH_SCOPE,
    state,
    codeChallenge: challenge,
  });

  return redirectResponse(authUrl, [
    serializeCookie(OAUTH_COOKIE, stash, sessionCookieOpts(request, OAUTH_STASH_TTL_SECONDS)),
  ]);
}

/**
 * GET /auth/callback?code&state — verify state, exchange the code (+ PKCE verifier
 * + client secret) for tokens, persist the refresh token in KV under a new opaque
 * session id, set the httpOnly session cookie, and redirect to the app.
 */
export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const home = appOrigin(request, env) + '/';
  const clearOauth = clearCookie(OAUTH_COOKIE, sessionCookieOpts(request, 0));

  // Google reported an error, or no code came back.
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (url.searchParams.get('error') || !code || !returnedState) {
    return redirectResponse(home + '?auth_error=1', [clearOauth]);
  }

  // Recover + verify the stashed PKCE verifier and CSRF state.
  const cookies = parseCookies(request.headers.get('Cookie'));
  const stashRaw = cookies[OAUTH_COOKIE];
  if (!stashRaw) return redirectResponse(home + '?auth_error=1', [clearOauth]);
  const stashStr = await unsign(stashRaw, env.COOKIE_SIGNING_KEY);
  if (!stashStr) return redirectResponse(home + '?auth_error=1', [clearOauth]);

  let stash: { state: string; verifier: string };
  try {
    stash = JSON.parse(stashStr) as { state: string; verifier: string };
  } catch {
    return redirectResponse(home + '?auth_error=1', [clearOauth]);
  }
  // CSRF: the state echoed by Google must match the one we stashed.
  if (!timingSafeEqual(returnedState, stash.state)) {
    return redirectResponse(home + '?auth_error=1', [clearOauth]);
  }

  // Exchange the code for tokens.
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: stash.verifier,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: redirectUri(request, env),
    });
  } catch {
    return redirectResponse(home + '?auth_error=1', [clearOauth]);
  }

  // Persist the session (refresh token + cached access token) under an opaque id.
  const sessionId = randomToken(32);
  const record: SessionRecord = {
    refreshToken: tokens.refresh_token ?? '',
    accessToken: tokens.access_token,
    accessTokenExpiry: Date.now() + tokens.expires_in * 1000,
    createdAt: Date.now(),
  };
  await env.SESSIONS.put(KV_PREFIX + sessionId, JSON.stringify(record), {
    expirationTtl: SESSION_TTL_SECONDS,
  });

  const signedSession = await sign(sessionId, env.COOKIE_SIGNING_KEY);
  return redirectResponse(home, [
    serializeCookie(SESSION_COOKIE, signedSession, sessionCookieOpts(request, SESSION_TTL_SECONDS)),
    serializeCookie(CONNECTED_HINT_COOKIE, '1', hintCookieOpts(request, SESSION_TTL_SECONDS)),
    clearOauth,
  ]);
}

/** Resolve + validate the session cookie to a session id, or null. */
async function readSessionId(request: Request, env: Env): Promise<string | null> {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  return unsign(raw, env.COOKIE_SIGNING_KEY);
}

/** Set-Cookie values that clear both the session cookie and the readable hint. */
function clearSessionCookies(request: Request): string[] {
  return [
    clearCookie(SESSION_COOKIE, sessionCookieOpts(request, 0)),
    clearCookie(CONNECTED_HINT_COOKIE, hintCookieOpts(request, 0)),
  ];
}

/**
 * GET /api/token — return a currently-valid access token for the session. Uses
 * the cached token when still fresh; otherwise refreshes via Google using the
 * stored refresh token and re-caches. 401 when there is no/invalid session or
 * when Google rejects the refresh (the SPA treats 401 as "reconnect").
 */
export async function handleToken(request: Request, env: Env): Promise<Response> {
  const sessionId = await readSessionId(request, env);
  if (!sessionId) return jsonResponse({ error: 'no_session' }, 401, clearSessionCookies(request));

  const recStr = await env.SESSIONS.get(KV_PREFIX + sessionId);
  if (!recStr) return jsonResponse({ error: 'no_session' }, 401, clearSessionCookies(request));

  let rec: SessionRecord;
  try {
    rec = JSON.parse(recStr) as SessionRecord;
  } catch {
    await env.SESSIONS.delete(KV_PREFIX + sessionId);
    return jsonResponse({ error: 'bad_session' }, 401, clearSessionCookies(request));
  }

  // Cached access token still comfortably valid → return it as-is.
  const remaining = rec.accessTokenExpiry - Date.now();
  if (remaining > ACCESS_TOKEN_SKEW_MS) {
    return jsonResponse(
      { access_token: rec.accessToken, expires_in: Math.floor(remaining / 1000) },
      200,
    );
  }

  // Need a refresh but have no refresh token → cannot continue; force reconnect.
  if (!rec.refreshToken) {
    await env.SESSIONS.delete(KV_PREFIX + sessionId);
    return jsonResponse({ error: 'no_refresh_token' }, 401, clearSessionCookies(request));
  }

  // Refresh via Google.
  try {
    const refreshed = await refreshAccessToken({
      refreshToken: rec.refreshToken,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    });
    const updated: SessionRecord = {
      ...rec,
      accessToken: refreshed.access_token,
      accessTokenExpiry: Date.now() + refreshed.expires_in * 1000,
      // Google usually omits refresh_token on refresh; keep the stored one unless
      // a new one is returned (e.g. rotation).
      refreshToken: refreshed.refresh_token ?? rec.refreshToken,
    };
    await env.SESSIONS.put(KV_PREFIX + sessionId, JSON.stringify(updated), {
      expirationTtl: SESSION_TTL_SECONDS,
    });
    return jsonResponse(
      { access_token: refreshed.access_token, expires_in: refreshed.expires_in },
      200,
    );
  } catch (err) {
    if (err instanceof TokenEndpointError) {
      // Google rejected the refresh token (revoked/expired/consent withdrawn):
      // the session is dead. Delete it and force a reconnect.
      await env.SESSIONS.delete(KV_PREFIX + sessionId);
      return jsonResponse({ error: 'refresh_rejected' }, 401, clearSessionCookies(request));
    }
    // Transient network failure reaching Google — keep the session; the SPA can
    // retry (and, when online with a cached client token, reuse it).
    return jsonResponse({ error: 'upstream_unavailable' }, 502);
  }
}

/** POST /auth/logout — delete the KV session and clear the cookies. */
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const sessionId = await readSessionId(request, env);
  if (sessionId) {
    await env.SESSIONS.delete(KV_PREFIX + sessionId);
  }
  return jsonResponse({ ok: true }, 200, clearSessionCookies(request));
}

/** GET /api/me — a lightweight "is there a live session?" probe for the SPA. */
export async function handleMe(request: Request, env: Env): Promise<Response> {
  const sessionId = await readSessionId(request, env);
  if (!sessionId) return jsonResponse({ connected: false }, 401);
  const recStr = await env.SESSIONS.get(KV_PREFIX + sessionId);
  if (!recStr) return jsonResponse({ connected: false }, 401, clearSessionCookies(request));
  return jsonResponse({ connected: true }, 200);
}
