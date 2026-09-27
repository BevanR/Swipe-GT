/**
 * Pure auth-strategy decision, extracted so it can be unit-tested without GIS,
 * IndexedDB, or the network. Given what we know about the cached credential and
 * connectivity, decide how to obtain an access token for an API call.
 *
 * The offline-first rule that fixes the "offline bounces to Connect" bug lives
 * here: when we are OFFLINE and hold a cached credential, we presume it is still
 * valid and reuse it rather than attempting a silent-renew round-trip (which
 * cannot succeed offline and used to surface as a fatal auth error).
 */
export type TokenStrategy = 'use-cached' | 'silent-renew' | 'reconnect';

export interface TokenStrategyInput {
  /** Whether a persisted OAuth credential exists at all. */
  hasCachedAuth: boolean;
  /** Whether that credential's access token is present and comfortably unexpired. */
  tokenFresh: boolean;
  /** Whether the browser reports it is online (network reachable). */
  online: boolean;
}

/**
 * - No cached credential → 'reconnect' (must sign in; never leaks into the
 *   logged-out case as "presumed valid").
 * - Fresh token → 'use-cached' (no round-trip needed).
 * - Stale token but OFFLINE → 'use-cached' (presume valid; skip the round-trip
 *   that cannot succeed offline — the ensuing fetch fails as a NETWORK error,
 *   which the caller handles by rendering cached data, not by signing out).
 * - Stale token and ONLINE → 'silent-renew' (a genuine chance to refresh).
 */
export function decideTokenStrategy(input: TokenStrategyInput): TokenStrategy {
  if (!input.hasCachedAuth) return 'reconnect';
  if (input.tokenFresh) return 'use-cached';
  if (!input.online) return 'use-cached';
  return 'silent-renew';
}
