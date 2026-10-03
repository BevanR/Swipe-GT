import { AUTH_MODE } from '../config';
import { AuthClient } from './authClient';
import { BrokerAuthClient } from './brokerAuthClient';

/**
 * The auth surface the controller depends on. Both {@link AuthClient} (GIS) and
 * {@link BrokerAuthClient} satisfy it; `disconnect` is optional (only the broker
 * needs a server round-trip to log out).
 */
export interface AuthClientLike {
  connect(): Promise<unknown>;
  getValidAccessToken(): Promise<string>;
  isConnected(): Promise<boolean>;
  disconnect?(): Promise<void>;
}

/**
 * Build the auth client for the configured {@link AUTH_MODE}. Default (`'gis'`)
 * returns the existing browser-only token client, so the GitHub Pages build and
 * all current tests are unaffected; the Cloudflare build sets broker mode.
 */
export function createAuthClient(): AuthClientLike {
  return AUTH_MODE === 'broker' ? new BrokerAuthClient() : new AuthClient();
}
