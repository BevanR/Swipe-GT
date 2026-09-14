import type { AuthState } from '../types';
import { GOOGLE_CLIENT_ID, OAUTH_SCOPE } from '../config';
import { getConfig, setConfig } from '../storage/db';

/**
 * Thrown when a silent access-token renewal fails. The UI should catch this
 * distinctly (vs. a generic error) and prompt the user to re-connect
 * interactively, since GIS token-client silent renewal requires a live,
 * previously-consented session.
 */
export class SilentRenewFailedError extends Error {
  constructor(message = 'Silent token renewal failed; interactive login required') {
    super(message);
    this.name = 'SilentRenewFailedError';
  }
}

/** URL of the Google Identity Services client library. */
const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** True once the GIS OAuth2 module is present on the page. */
function gisReady(): boolean {
  return typeof google !== 'undefined' && !!google?.accounts?.oauth2;
}

/** Inject the GIS <script> once and await its load (no-op if already present). */
let gisLoadPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (gisReady()) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load GIS')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Failed to load GIS')));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

/**
 * Wraps the Google Identity Services (GIS) OAuth 2.0 token client.
 *
 * GIS is loaded at runtime from https://accounts.google.com/gsi/client and is
 * NOT bundled; `window.google.accounts.oauth2` must be available before
 * {@link connect} is called (it is injected lazily by this client).
 */
export class AuthClient {
  private tokenClient: google.accounts.oauth2.TokenClient | null = null;
  private pending: {
    resolve: (r: google.accounts.oauth2.TokenResponse) => void;
    reject: (e: Error) => void;
  } | null = null;

  private async ensureClient(): Promise<google.accounts.oauth2.TokenClient> {
    await loadGis();
    if (!this.tokenClient) {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: OAUTH_SCOPE,
        callback: (response) => {
          const p = this.pending;
          this.pending = null;
          if (!p) return;
          if (response.error) {
            p.reject(new Error(response.error_description || response.error));
            return;
          }
          p.resolve(response);
        },
        error_callback: (err) => {
          const p = this.pending;
          this.pending = null;
          if (p) p.reject(new Error(err.message || err.type || 'GIS token error'));
        },
      });
    }
    return this.tokenClient;
  }

  private requestToken(
    overrideConfig?: google.accounts.oauth2.OverridableTokenClientConfig,
  ): Promise<google.accounts.oauth2.TokenResponse> {
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      const client = this.tokenClient;
      if (!client) {
        this.pending = null;
        reject(new Error('Token client not initialized'));
        return;
      }
      if (overrideConfig) {
        client.requestAccessToken(overrideConfig);
      } else {
        client.requestAccessToken();
      }
    });
  }

  private toAuthState(r: google.accounts.oauth2.TokenResponse): AuthState {
    return {
      accessToken: r.access_token,
      accessTokenExpiry: Date.now() + Number(r.expires_in) * 1000,
    };
  }

  /**
   * Interactive sign-in / consent. Opens the Google token-client popup and
   * resolves with a fresh {@link AuthState}. Rejects if the user cancels or
   * consent fails.
   */
  async connect(): Promise<AuthState> {
    await this.ensureClient();
    const response = await this.requestToken();
    const auth = this.toAuthState(response);
    await setConfig({ auth });
    return auth;
  }

  /**
   * Returns a valid access token, silently renewing if the current one is
   * missing or expired. Throws {@link SilentRenewFailedError} when silent
   * renewal is not possible so the UI can fall back to {@link connect}.
   */
  async getValidAccessToken(): Promise<string> {
    const { auth } = await getConfig();
    if (auth && auth.accessTokenExpiry - Date.now() > 60_000) {
      return auth.accessToken;
    }
    if (!auth) {
      throw new SilentRenewFailedError();
    }
    try {
      await this.ensureClient();
      const response = await this.requestToken({ prompt: '' });
      const renewed = this.toAuthState(response);
      await setConfig({ auth: renewed });
      return renewed.accessToken;
    } catch {
      throw new SilentRenewFailedError();
    }
  }

  /**
   * True when an auth state is currently persisted. Async because the auth
   * state lives in IndexedDB (see report: extended from the synchronous stub).
   */
  async isConnected(): Promise<boolean> {
    return (await getConfig()).auth != null;
  }
}
