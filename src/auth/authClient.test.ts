import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthClient, SilentRenewFailedError } from './authClient';
import { _resetDbForTests, getConfig, setConfig } from '../storage/db';

type Cfg = google.accounts.oauth2.TokenClientConfig;
type TokenResponse = google.accounts.oauth2.TokenResponse;

let capturedConfig: Cfg | null = null;
let behavior: 'success' | 'error';
let response: Partial<TokenResponse>;
const requestAccessToken = vi.fn(() => {
  if (behavior === 'success') {
    capturedConfig?.callback(response as TokenResponse);
  } else {
    capturedConfig?.error_callback?.({
      type: 'unknown',
      message: 'silent renewal failed',
      name: 'Error',
    } as google.accounts.oauth2.ClientConfigError);
  }
});

function installFakeGis() {
  const fake = {
    accounts: {
      oauth2: {
        initTokenClient: (config: Cfg) => {
          capturedConfig = config;
          return { requestAccessToken };
        },
      },
    },
  };
  (globalThis as unknown as { google: unknown }).google = fake;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDbForTests();
  requestAccessToken.mockClear();
  capturedConfig = null;
  behavior = 'success';
  response = { access_token: 'fresh-token', expires_in: '3600' };
  installFakeGis();
});

describe('AuthClient.connect', () => {
  it('requests a token interactively and persists the auth state', async () => {
    const before = Date.now();
    const auth = await new AuthClient().connect();

    expect(auth.accessToken).toBe('fresh-token');
    expect(auth.accessTokenExpiry).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(requestAccessToken).toHaveBeenCalledTimes(1);

    const stored = (await getConfig()).auth;
    expect(stored).toEqual(auth);
  });
});

describe('AuthClient.getValidAccessToken', () => {
  it('returns a still-valid token without renewing', async () => {
    await setConfig({
      auth: { accessToken: 'valid-token', accessTokenExpiry: Date.now() + 10 * 60 * 1000 },
    });

    const token = await new AuthClient().getValidAccessToken();
    expect(token).toBe('valid-token');
    expect(requestAccessToken).not.toHaveBeenCalled();
  });

  it('silently renews a token that is within 60s of expiry', async () => {
    await setConfig({
      auth: { accessToken: 'stale', accessTokenExpiry: Date.now() + 30 * 1000 },
    });
    response = { access_token: 'renewed-token', expires_in: '3600' };

    const token = await new AuthClient().getValidAccessToken();
    expect(token).toBe('renewed-token');
    expect(requestAccessToken).toHaveBeenCalledTimes(1);
    expect((await getConfig()).auth?.accessToken).toBe('renewed-token');
  });

  it('throws SilentRenewFailedError when there is no auth at all', async () => {
    await expect(new AuthClient().getValidAccessToken()).rejects.toBeInstanceOf(
      SilentRenewFailedError,
    );
    expect(requestAccessToken).not.toHaveBeenCalled();
  });

  it('throws SilentRenewFailedError when the silent renewal errors', async () => {
    await setConfig({
      auth: { accessToken: 'stale', accessTokenExpiry: Date.now() + 1000 },
    });
    behavior = 'error';

    await expect(new AuthClient().getValidAccessToken()).rejects.toBeInstanceOf(
      SilentRenewFailedError,
    );
    expect(requestAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe('AuthClient.isConnected', () => {
  it('reflects persisted auth state', async () => {
    const client = new AuthClient();
    expect(await client.isConnected()).toBe(false);
    await setConfig({ auth: { accessToken: 't', accessTokenExpiry: Date.now() + 1000 } });
    expect(await client.isConnected()).toBe(true);
  });
});
