// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  TokenEndpointError,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
} from './oauth';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildAuthorizationUrl', () => {
  it('includes all code-flow + offline + PKCE + CSRF parameters', () => {
    const url = new URL(
      buildAuthorizationUrl({
        clientId: 'cid.apps.googleusercontent.com',
        redirectUri: 'https://app.example/auth/callback',
        scope: 'https://www.googleapis.com/auth/tasks',
        state: 'state-xyz',
        codeChallenge: 'challenge-abc',
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_ENDPOINT);
    const q = url.searchParams;
    expect(q.get('client_id')).toBe('cid.apps.googleusercontent.com');
    expect(q.get('redirect_uri')).toBe('https://app.example/auth/callback');
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe('https://www.googleapis.com/auth/tasks');
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('prompt')).toBe('consent');
    expect(q.get('include_granted_scopes')).toBe('true');
    expect(q.get('state')).toBe('state-xyz');
    expect(q.get('code_challenge')).toBe('challenge-abc');
    expect(q.get('code_challenge_method')).toBe('S256');
  });
});

describe('exchangeCodeForTokens', () => {
  it('POSTs the correct form body and returns the parsed tokens', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          expires_in: 3599,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/tasks',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await exchangeCodeForTokens({
      code: 'auth-code',
      codeVerifier: 'verifier-123',
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'https://app.example/auth/callback',
    });

    expect(tokens.access_token).toBe('at-1');
    expect(tokens.refresh_token).toBe('rt-1');
    expect(tokens.expires_in).toBe(3599);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(GOOGLE_TOKEN_ENDPOINT);
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('code_verifier')).toBe('verifier-123');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('secret');
    expect(body.get('redirect_uri')).toBe('https://app.example/auth/callback');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('throws TokenEndpointError when Google rejects the exchange', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
      ),
    );
    await expect(
      exchangeCodeForTokens({
        code: 'bad',
        codeVerifier: 'v',
        clientId: 'cid',
        clientSecret: 'secret',
        redirectUri: 'https://app.example/auth/callback',
      }),
    ).rejects.toBeInstanceOf(TokenEndpointError);
  });
});

describe('refreshAccessToken', () => {
  it('POSTs grant_type=refresh_token and returns a new access token', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: 'at-2', expires_in: 3600, token_type: 'Bearer' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await refreshAccessToken({
      refreshToken: 'rt-1',
      clientId: 'cid',
      clientSecret: 'secret',
    });
    expect(res.access_token).toBe('at-2');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('secret');
  });

  it('throws TokenEndpointError when the refresh token is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
      ),
    );
    await expect(
      refreshAccessToken({ refreshToken: 'dead', clientId: 'cid', clientSecret: 'secret' }),
    ).rejects.toBeInstanceOf(TokenEndpointError);
  });
});
