import type { AuthState } from '../types';
import { getConfig, setConfig } from '../storage/db';
import { decideTokenStrategy } from './tokenStrategy';
import { SilentRenewFailedError } from './authClient';
import { CONNECTED_HINT_COOKIE } from './brokerPaths';
import { LOGIN_PATH, LOGOUT_PATH, TOKEN_PATH } from './brokerPaths';

/** True unless the browser explicitly reports it is offline. */
function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * True when the readable "connected" hint cookie is present. The real session
 * credential is an httpOnly cookie that page JS can NEVER read; the broker ALSO
 * sets this non-secret readable boolean hint purely so the SPA's boot knows a
 * session exists (and can go straight to loading rather than the Connect screen),
 * including on the very first page load right after `/auth/callback`, before any
 * access token has been cached locally.
 */
function hasConnectedHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie
    .split(';')
    .some((c) => c.trim().startsWith(`${CONNECTED_HINT_COOKIE}=`));
}

/** Best-effort clear of the readable hint cookie (defence in depth on logout). */
function clearConnectedHint(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${CONNECTED_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Auth client for **broker mode**: a same-origin Cloudflare Worker holds the
 * Google refresh token and mints short-lived access tokens, so login is
 * permanent. Implements the same surface as {@link AuthClient} (`connect`,
 * `getValidAccessToken`, `isConnected`, `disconnect`) so it drops straight into
 * the controller behind the existing {@link AuthLike} abstraction.
 *
 * It reuses the project's offline-first {@link decideTokenStrategy}: the last
 * minted access token is cached in IndexedDB (`config.auth`, the same shape GIS
 * mode uses), so when OFFLINE we presume a cached token valid and render the
 * snapshot instead of calling `/api/token` — exactly as GIS mode does.
 */
export class BrokerAuthClient {
  /**
   * Begin login: a FULL-PAGE redirect to the broker's `/auth/login` (not a
   * popup). The returned promise never resolves because the page navigates away;
   * callers simply `await` it until the unload.
   */
  async connect(): Promise<AuthState> {
    if (typeof window !== 'undefined') {
      window.location.assign(LOGIN_PATH);
    }
    return new Promise<AuthState>(() => {
      /* never resolves: the browser is navigating to Google */
    });
  }

  /**
   * Return a valid access token. Online, this fetches `/api/token` (the Worker
   * refreshes from the stored refresh token as needed) and caches the result.
   * A 401 means the session is gone/revoked → {@link SilentRenewFailedError} so
   * the app routes to Connect. Offline, a cached token is presumed valid and
   * reused (no doomed round-trip), matching the GIS offline-first behaviour.
   */
  async getValidAccessToken(): Promise<string> {
    const { auth } = await getConfig();
    const strategy = decideTokenStrategy({
      // A broker session "exists" if we hold a cached token OR the readable hint
      // cookie is present (fresh post-callback case, before any token is cached).
      hasCachedAuth: auth != null || hasConnectedHint(),
      tokenFresh: auth != null && auth.accessTokenExpiry - Date.now() > 60_000,
      online: isOnline(),
    });

    if (strategy === 'reconnect') {
      throw new SilentRenewFailedError();
    }
    if (strategy === 'use-cached') {
      // Fresh cached token, or a stale one while offline → reuse it. If we somehow
      // have no cached token at all (offline immediately after callback), we can't
      // produce one; surface a renew failure (offline-first renders the snapshot).
      if (auth != null) return auth.accessToken;
      throw new SilentRenewFailedError();
    }

    // strategy === 'silent-renew': online — ask the broker for a token.
    let res: Response;
    try {
      res = await fetch(TOKEN_PATH, { credentials: 'include' });
    } catch {
      // Network error (NOT an auth failure). Reuse a cached token if we have one;
      // otherwise fail the renew so offline-first handling takes over.
      if (auth != null) return auth.accessToken;
      throw new SilentRenewFailedError();
    }

    if (res.status === 401) {
      // The session is gone/revoked — clear the local cache and force reconnect.
      await setConfig({ auth: null });
      throw new SilentRenewFailedError();
    }
    if (!res.ok) {
      // Transient upstream error (e.g. 502). Reuse a cached token if present.
      if (auth != null) return auth.accessToken;
      throw new SilentRenewFailedError();
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    const renewed: AuthState = {
      accessToken: data.access_token,
      accessTokenExpiry: Date.now() + Number(data.expires_in) * 1000,
    };
    await setConfig({ auth: renewed });
    return renewed.accessToken;
  }

  /**
   * True when a broker session is believed to exist: either a cached token in
   * IndexedDB or the readable hint cookie (the fresh post-callback case). Boot
   * uses this to decide between loading and the Connect screen.
   */
  async isConnected(): Promise<boolean> {
    const { auth } = await getConfig();
    return auth != null || hasConnectedHint();
  }

  /** Log out: tell the broker to delete the server session, then clear local state. */
  async disconnect(): Promise<void> {
    try {
      await fetch(LOGOUT_PATH, { method: 'POST', credentials: 'include' });
    } catch {
      /* best-effort: even if the network call fails, clear local state below */
    }
    await setConfig({ auth: null });
    clearConnectedHint();
  }
}
