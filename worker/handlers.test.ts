// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  handleLogin,
  handleCallback,
  handleToken,
  handleLogout,
  handleMe,
} from './handlers';
import { sign } from './crypto';
import { SESSION_COOKIE, OAUTH_COOKIE, CONNECTED_HINT_COOKIE } from './cookies';
import type { Env, KVNamespace, SessionRecord } from './types';

const KEY = 'unit-test-cookie-signing-key';

/** In-memory KV implementing the slice of KVNamespace the handlers use. */
function makeKV(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function makeEnv(kv: KVNamespace): Env {
  return {
    ASSETS: { fetch: async () => new Response('asset') },
    SESSIONS: kv,
    GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
    OAUTH_SCOPE: 'https://www.googleapis.com/auth/tasks',
    APP_ORIGIN: '',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    COOKIE_SIGNING_KEY: KEY,
  };
}

const ORIGIN = 'https://app.example';

function req(path: string, init: RequestInit & { cookies?: Record<string, string> } = {}) {
  const { cookies, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookies) {
    headers.set(
      'Cookie',
      Object.entries(cookies)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('; '),
    );
  }
  return new Request(`${ORIGIN}${path}`, { ...rest, headers });
}

/** Parse the Set-Cookie headers of a response into a name→{value,attrs} map. */
function setCookies(res: Response): Record<string, { value: string; raw: string }> {
  const out: Record<string, { value: string; raw: string }> = {};
  for (const raw of res.headers.getSetCookie()) {
    const first = raw.split(';')[0];
    const eq = first.indexOf('=');
    const name = first.slice(0, eq);
    out[name] = { value: decodeURIComponent(first.slice(eq + 1)), raw };
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handleLogin', () => {
  it('redirects to Google with PKCE + state and stashes a signed oauth cookie', async () => {
    const env = makeEnv(makeKV());
    const res = await handleLogin(req('/auth/login'), env);

    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('Location')!);
    expect(loc.host).toBe('accounts.google.com');
    expect(loc.searchParams.get('response_type')).toBe('code');
    expect(loc.searchParams.get('access_type')).toBe('offline');
    expect(loc.searchParams.get('prompt')).toBe('consent');
    expect(loc.searchParams.get('code_challenge')).toBeTruthy();
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
    const state = loc.searchParams.get('state');
    expect(state).toBeTruthy();

    const cookies = setCookies(res);
    const stash = cookies[OAUTH_COOKIE];
    expect(stash).toBeTruthy();
    expect(stash.raw).toContain('HttpOnly');
    expect(stash.raw).toContain('SameSite=Lax');
    expect(stash.raw).toContain('Secure'); // https origin
  });
});

/** Run a full login→callback and return the signed session cookie + KV + env. */
async function loginThenCallback(options: {
  tokenResponse?: unknown;
  tokenStatus?: number;
  tamperState?: boolean;
  dropOauthCookie?: boolean;
} = {}) {
  const kv = makeKV();
  const env = makeEnv(kv);

  const loginRes = await handleLogin(req('/auth/login'), env);
  const loc = new URL(loginRes.headers.get('Location')!);
  const state = loc.searchParams.get('state')!;
  const oauthCookie = setCookies(loginRes)[OAUTH_COOKIE].value;

  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify(
          options.tokenResponse ?? {
            access_token: 'at-initial',
            refresh_token: 'rt-initial',
            expires_in: 3600,
          },
        ),
        { status: options.tokenStatus ?? 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );

  const usedState = options.tamperState ? 'wrong-state' : state;
  const cbReq = req(`/auth/callback?code=the-code&state=${usedState}`, {
    cookies: options.dropOauthCookie ? {} : { [OAUTH_COOKIE]: oauthCookie },
  });
  const cbRes = await handleCallback(cbReq, env);
  return { kv, env, cbRes };
}

describe('handleCallback', () => {
  it('exchanges the code, stores the session in KV, and sets session + hint cookies', async () => {
    const { kv, cbRes } = await loginThenCallback();

    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.get('Location')).toBe(`${ORIGIN}/`);

    // Exactly one session persisted, holding the refresh token.
    const entries = [...kv.store.entries()].filter(([k]) => k.startsWith('session:'));
    expect(entries.length).toBe(1);
    const rec = JSON.parse(entries[0][1]) as SessionRecord;
    expect(rec.refreshToken).toBe('rt-initial');
    expect(rec.accessToken).toBe('at-initial');

    const cookies = setCookies(cbRes);
    expect(cookies[SESSION_COOKIE].raw).toContain('HttpOnly');
    expect(cookies[SESSION_COOKIE].raw).toContain('SameSite=Lax');
    // The readable hint cookie is NOT httpOnly.
    expect(cookies[CONNECTED_HINT_COOKIE].value).toBe('1');
    expect(cookies[CONNECTED_HINT_COOKIE].raw).not.toContain('HttpOnly');
    // The oauth stash cookie is cleared.
    expect(cookies[OAUTH_COOKIE].raw).toContain('Max-Age=0');
  });

  it('rejects a state mismatch (CSRF) without storing a session', async () => {
    const { kv, cbRes } = await loginThenCallback({ tamperState: true });
    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.get('Location')).toContain('auth_error=1');
    expect([...kv.store.keys()].filter((k) => k.startsWith('session:')).length).toBe(0);
  });

  it('rejects a missing oauth stash cookie', async () => {
    const { kv, cbRes } = await loginThenCallback({ dropOauthCookie: true });
    expect(cbRes.headers.get('Location')).toContain('auth_error=1');
    expect([...kv.store.keys()].length).toBe(0);
  });

  it('redirects with an error when the token exchange fails', async () => {
    const { kv, cbRes } = await loginThenCallback({ tokenStatus: 400, tokenResponse: { error: 'invalid_grant' } });
    expect(cbRes.headers.get('Location')).toContain('auth_error=1');
    expect([...kv.store.keys()].filter((k) => k.startsWith('session:')).length).toBe(0);
  });
});

/** Seed a session in KV and return a request carrying its signed cookie. */
async function sessionReq(
  path: string,
  kv: KVNamespace,
  record: SessionRecord,
  method = 'GET',
): Promise<Request> {
  const sessionId = 'sess-fixed-id';
  await kv.put(`session:${sessionId}`, JSON.stringify(record));
  const signed = await sign(sessionId, KEY);
  return req(path, { method, cookies: { [SESSION_COOKIE]: signed } });
}

describe('handleToken', () => {
  it('returns the cached access token when it is still valid (no refresh)', async () => {
    const kv = makeKV();
    const env = makeEnv(kv);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r = await sessionReq('/api/token', kv, {
      refreshToken: 'rt',
      accessToken: 'cached-at',
      accessTokenExpiry: Date.now() + 10 * 60 * 1000,
      createdAt: Date.now(),
    });
    const res = await handleToken(r, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string };
    expect(body.access_token).toBe('cached-at');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes via Google and re-caches when the cached token is expired', async () => {
    const kv = makeKV();
    const env = makeEnv(kv);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: 'fresh-at', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const r = await sessionReq('/api/token', kv, {
      refreshToken: 'rt',
      accessToken: 'stale-at',
      accessTokenExpiry: Date.now() - 1000,
      createdAt: Date.now(),
    });
    const res = await handleToken(r, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string };
    expect(body.access_token).toBe('fresh-at');
    // Re-cached in KV.
    const rec = JSON.parse((await kv.get('session:sess-fixed-id'))!) as SessionRecord;
    expect(rec.accessToken).toBe('fresh-at');
    expect(rec.refreshToken).toBe('rt'); // kept
  });

  it('returns 401 when there is no session cookie', async () => {
    const env = makeEnv(makeKV());
    const res = await handleToken(req('/api/token'), env);
    expect(res.status).toBe(401);
  });

  it('returns 401 and clears the cookie when the session is not in KV', async () => {
    const kv = makeKV();
    const env = makeEnv(kv);
    const signed = await sign('ghost-id', KEY);
    const res = await handleToken(req('/api/token', { cookies: { [SESSION_COOKIE]: signed } }), env);
    expect(res.status).toBe(401);
    expect(setCookies(res)[SESSION_COOKIE].raw).toContain('Max-Age=0');
  });

  it('returns 401 and deletes the session when Google rejects the refresh', async () => {
    const kv = makeKV();
    const env = makeEnv(kv);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    );
    const r = await sessionReq('/api/token', kv, {
      refreshToken: 'revoked-rt',
      accessToken: 'stale',
      accessTokenExpiry: Date.now() - 1000,
      createdAt: Date.now(),
    });
    const res = await handleToken(r, env);
    expect(res.status).toBe(401);
    expect(await kv.get('session:sess-fixed-id')).toBeNull();
  });

  it('returns 502 (keeps the session) on a transient network failure to Google', async () => {
    const kv = makeKV();
    const env = makeEnv(kv);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const r = await sessionReq('/api/token', kv, {
      refreshToken: 'rt',
      accessToken: 'stale',
      accessTokenExpiry: Date.now() - 1000,
      createdAt: Date.now(),
    });
    const res = await handleToken(r, env);
    expect(res.status).toBe(502);
    expect(await kv.get('session:sess-fixed-id')).not.toBeNull();
  });
});

describe('handleLogout', () => {
  it('deletes the KV session and clears the cookies', async () => {
    const kv = makeKV();
    const env = makeEnv(kv);
    const r = await sessionReq('/auth/logout', kv, {
      refreshToken: 'rt',
      accessToken: 'at',
      accessTokenExpiry: Date.now() + 1000,
      createdAt: Date.now(),
    }, 'POST');
    const res = await handleLogout(r, env);
    expect(res.status).toBe(200);
    expect(await kv.get('session:sess-fixed-id')).toBeNull();
    const cookies = setCookies(res);
    expect(cookies[SESSION_COOKIE].raw).toContain('Max-Age=0');
    expect(cookies[CONNECTED_HINT_COOKIE].raw).toContain('Max-Age=0');
  });
});

describe('handleMe', () => {
  it('reports connected for a live session and 401 otherwise', async () => {
    const kv = makeKV();
    const env = makeEnv(kv);
    const r = await sessionReq('/api/me', kv, {
      refreshToken: 'rt',
      accessToken: 'at',
      accessTokenExpiry: Date.now() + 1000,
      createdAt: Date.now(),
    });
    const ok = await handleMe(r, env);
    expect(ok.status).toBe(200);
    expect((await ok.json()) as { connected: boolean }).toEqual({ connected: true });

    const anon = await handleMe(req('/api/me'), env);
    expect(anon.status).toBe(401);
  });
});
