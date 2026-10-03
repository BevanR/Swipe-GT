// Google OAuth 2.0 "authorization code flow with offline access + PKCE" — the
// server half that the SPA's browser-only GIS token flow could not do.
//
// Confirmed against Google's current OAuth 2.0 for Web Server Applications docs
// (2026): authorization endpoint accounts.google.com/o/oauth2/v2/auth, token
// endpoint oauth2.googleapis.com/token. `access_type=offline` + `prompt=consent`
// are what make Google return a refresh_token; PKCE (`code_challenge` /
// `code_verifier`, S256) hardens the code exchange.

import type { GoogleTokenResponse } from './types';

/** Google's OAuth 2.0 authorization endpoint (shows the consent screen). */
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Google's OAuth 2.0 token endpoint (code exchange + refresh). */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface AuthorizationUrlParams {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
}

/**
 * Build the Google authorization URL for the code flow:
 *  - `response_type=code`                 → authorization code flow
 *  - `access_type=offline`                → issue a refresh token
 *  - `prompt=consent`                     → force refresh-token issuance even on
 *                                            a repeat authorization
 *  - `include_granted_scopes=true`        → incremental authorization
 *  - `code_challenge` + `..._method=S256` → PKCE
 *  - `state`                              → CSRF protection (verified on callback)
 */
export function buildAuthorizationUrl(params: AuthorizationUrlParams): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  const q = url.searchParams;
  q.set('client_id', params.clientId);
  q.set('redirect_uri', params.redirectUri);
  q.set('response_type', 'code');
  q.set('scope', params.scope);
  q.set('access_type', 'offline');
  q.set('prompt', 'consent');
  q.set('include_granted_scopes', 'true');
  q.set('state', params.state);
  q.set('code_challenge', params.codeChallenge);
  q.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Thrown when Google's token endpoint rejects a request (4xx with a body). */
export class TokenEndpointError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Google token endpoint ${status}: ${body}`);
    this.name = 'TokenEndpointError';
    this.status = status;
    this.body = body;
  }
}

export interface ExchangeParams {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Exchange an authorization `code` (+ PKCE verifier + client credentials) for
 * `{access_token, refresh_token, expires_in, ...}` at Google's token endpoint.
 * Throws {@link TokenEndpointError} if Google rejects the exchange.
 */
export async function exchangeCodeForTokens(
  params: ExchangeParams,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: params.codeVerifier,
  });
  return postToken(body);
}

export interface RefreshParams {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Obtain a fresh access token from a stored refresh token. Google normally does
 * NOT return a new refresh_token here (the old one stays valid). Throws
 * {@link TokenEndpointError} if the refresh is rejected (revoked/expired token).
 */
export async function refreshAccessToken(
  params: RefreshParams,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken,
    grant_type: 'refresh_token',
  });
  return postToken(body);
}

/** POST a form body to Google's token endpoint and parse the JSON response. */
async function postToken(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new TokenEndpointError(res.status, text);
  }
  return (await res.json()) as GoogleTokenResponse;
}
