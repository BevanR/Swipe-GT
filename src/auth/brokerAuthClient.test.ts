import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BrokerAuthClient } from './brokerAuthClient';
import { SilentRenewFailedError } from './authClient';
import { CONNECTED_HINT_COOKIE } from './brokerPaths';
import { _resetDbForTests, getConfig, setConfig } from '../storage/db';

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

/** Clear all cookies jsdom currently holds. */
function clearCookies(): void {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

function setHint(): void {
  document.cookie = `${CONNECTED_HINT_COOKIE}=1; Path=/`;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDbForTests();
  clearCookies();
  setOnline(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BrokerAuthClient.connect', () => {
  it('full-page redirects to /auth/login', async () => {
    // jsdom's location.assign is non-configurable, so replace the whole location
    // object with a stub for this test, then restore it.
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { assign } });
    try {
      // connect() never resolves (the page navigates away); don't await it.
      void new BrokerAuthClient().connect();
      await Promise.resolve();
      expect(assign).toHaveBeenCalledWith('/auth/login');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});

describe('BrokerAuthClient.getValidAccessToken', () => {
  it('returns a still-valid cached token without hitting /api/token', async () => {
    await setConfig({
      auth: { accessToken: 'cached', accessTokenExpiry: Date.now() + 10 * 60 * 1000 },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const token = await new BrokerAuthClient().getValidAccessToken();
    expect(token).toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches /api/token and caches the token when none is cached yet (post-callback)', async () => {
    setHint(); // hint present, no cached token (fresh after /auth/callback)
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'broker-at', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const token = await new BrokerAuthClient().getValidAccessToken();
    expect(token).toBe('broker-at');
    expect(fetchMock).toHaveBeenCalledWith('/api/token', { credentials: 'include' });
    // Cached for offline-first reuse.
    expect((await getConfig()).auth?.accessToken).toBe('broker-at');
  });

  it('throws SilentRenewFailedError and clears auth on 401', async () => {
    await setConfig({
      auth: { accessToken: 'stale', accessTokenExpiry: Date.now() - 1000 },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));

    await expect(new BrokerAuthClient().getValidAccessToken()).rejects.toBeInstanceOf(
      SilentRenewFailedError,
    );
    expect((await getConfig()).auth).toBeNull();
  });

  it('OFFLINE with a stale cached token reuses it WITHOUT calling /api/token', async () => {
    await setConfig({
      auth: { accessToken: 'stale-but-usable', accessTokenExpiry: Date.now() - 1000 },
    });
    setOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const token = await new BrokerAuthClient().getValidAccessToken();
    expect(token).toBe('stale-but-usable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when there is no cached token and no connected hint (logged out)', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(new BrokerAuthClient().getValidAccessToken()).rejects.toBeInstanceOf(
      SilentRenewFailedError,
    );
  });

  it('reuses a cached token on a transient network error (not an auth failure)', async () => {
    await setConfig({
      auth: { accessToken: 'cached-stale', accessTokenExpiry: Date.now() - 1000 },
    });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));

    const token = await new BrokerAuthClient().getValidAccessToken();
    expect(token).toBe('cached-stale');
  });
});

describe('BrokerAuthClient.isConnected', () => {
  it('is true with a cached token', async () => {
    await setConfig({ auth: { accessToken: 't', accessTokenExpiry: Date.now() + 1000 } });
    expect(await new BrokerAuthClient().isConnected()).toBe(true);
  });

  it('is true with only the connected hint cookie (fresh post-callback)', async () => {
    setHint();
    expect(await new BrokerAuthClient().isConnected()).toBe(true);
  });

  it('is false with neither', async () => {
    expect(await new BrokerAuthClient().isConnected()).toBe(false);
  });
});

describe('BrokerAuthClient.disconnect', () => {
  it('posts /auth/logout and clears local auth + hint', async () => {
    await setConfig({ auth: { accessToken: 't', accessTokenExpiry: Date.now() + 1000 } });
    setHint();
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await new BrokerAuthClient().disconnect();
    expect(fetchMock).toHaveBeenCalledWith('/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    expect((await getConfig()).auth).toBeNull();
    expect(document.cookie).not.toContain(`${CONNECTED_HINT_COOKIE}=1`);
  });

  it('still clears local auth even if the logout request fails', async () => {
    await setConfig({ auth: { accessToken: 't', accessTokenExpiry: Date.now() + 1000 } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    await new BrokerAuthClient().disconnect();
    expect((await getConfig()).auth).toBeNull();
  });
});
