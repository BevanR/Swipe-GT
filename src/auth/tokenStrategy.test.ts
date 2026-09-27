import { describe, expect, it } from 'vitest';
import { decideTokenStrategy } from './tokenStrategy';

describe('decideTokenStrategy', () => {
  it('reconnects when there is no cached credential (never "presume valid")', () => {
    expect(
      decideTokenStrategy({ hasCachedAuth: false, tokenFresh: false, online: true }),
    ).toBe('reconnect');
    // Even offline, a logged-out user must reconnect (no leak into that case).
    expect(
      decideTokenStrategy({ hasCachedAuth: false, tokenFresh: false, online: false }),
    ).toBe('reconnect');
  });

  it('uses the cached token when it is still fresh', () => {
    expect(
      decideTokenStrategy({ hasCachedAuth: true, tokenFresh: true, online: true }),
    ).toBe('use-cached');
    expect(
      decideTokenStrategy({ hasCachedAuth: true, tokenFresh: true, online: false }),
    ).toBe('use-cached');
  });

  it('silently renews a stale token while ONLINE', () => {
    expect(
      decideTokenStrategy({ hasCachedAuth: true, tokenFresh: false, online: true }),
    ).toBe('silent-renew');
  });

  it('presumes a stale token valid while OFFLINE (skips the doomed round-trip)', () => {
    expect(
      decideTokenStrategy({ hasCachedAuth: true, tokenFresh: false, online: false }),
    ).toBe('use-cached');
  });
});
