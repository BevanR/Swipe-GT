import type { AuthState } from '../types';

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

/**
 * Wraps the Google Identity Services (GIS) OAuth 2.0 token client.
 *
 * GIS is loaded at runtime from https://accounts.google.com/gsi/client and is
 * NOT bundled; `window.google.accounts.oauth2` must be available before
 * {@link connect} is called.
 */
export class AuthClient {
  /**
   * Interactive sign-in / consent. Opens the Google token-client popup and
   * resolves with a fresh {@link AuthState}. Rejects if the user cancels or
   * consent fails.
   */
  async connect(): Promise<AuthState> {
    throw new Error('not implemented');
  }

  /**
   * Returns a valid access token, silently renewing if the current one is
   * missing or expired. Throws {@link SilentRenewFailedError} when silent
   * renewal is not possible so the UI can fall back to {@link connect}.
   */
  async getValidAccessToken(): Promise<string> {
    throw new Error('not implemented');
  }

  /**
   * True when a non-expired access token is currently held in memory/storage.
   */
  isConnected(): boolean {
    throw new Error('not implemented');
  }
}
