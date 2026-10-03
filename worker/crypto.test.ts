// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  base64UrlEncode,
  base64UrlDecode,
  randomToken,
  generateCodeVerifier,
  codeChallengeS256,
  hmacSign,
  timingSafeEqual,
  sign,
  unsign,
} from './crypto';

describe('base64url', () => {
  it('round-trips arbitrary bytes and is URL-safe (no +/= chars)', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63]);
    const enc = base64UrlEncode(bytes);
    expect(enc).not.toMatch(/[+/=]/);
    expect([...base64UrlDecode(enc)]).toEqual([...bytes]);
  });
});

describe('randomToken', () => {
  it('produces distinct, URL-safe tokens of the expected length', () => {
    const a = randomToken(32);
    const b = randomToken(32);
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/[+/=]/);
    // 32 bytes → 43 base64url chars (no padding).
    expect(a.length).toBe(43);
  });
});

describe('PKCE code challenge (S256)', () => {
  it('is deterministic for a given verifier and matches the known RFC 7636 vector', async () => {
    // RFC 7636 Appendix B test vector.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await codeChallengeS256(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    // Deterministic.
    expect(await codeChallengeS256(verifier)).toBe(challenge);
  });

  it('generateCodeVerifier yields a valid-length verifier', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
  });
});

describe('timingSafeEqual', () => {
  it('is true only for identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('hmacSign / sign / unsign', () => {
  const KEY = 'test-signing-key-please-change';

  it('hmacSign is deterministic and key-dependent', async () => {
    const a = await hmacSign('hello', KEY);
    expect(await hmacSign('hello', KEY)).toBe(a);
    expect(await hmacSign('hello', 'other-key')).not.toBe(a);
  });

  it('sign/unsign round-trips the original value', async () => {
    const signed = await sign('opaque-session-id', KEY);
    expect(signed).toContain('.');
    expect(await unsign(signed, KEY)).toBe('opaque-session-id');
  });

  it('unsign rejects a tampered value', async () => {
    const signed = await sign('session-123', KEY);
    const tampered = signed.replace('session-123', 'session-999');
    expect(await unsign(tampered, KEY)).toBeNull();
  });

  it('unsign rejects a tampered signature', async () => {
    const signed = await sign('session-123', KEY);
    const [value] = signed.split('.');
    expect(await unsign(`${value}.not-the-real-sig`, KEY)).toBeNull();
  });

  it('unsign rejects the wrong key', async () => {
    const signed = await sign('session-123', KEY);
    expect(await unsign(signed, 'different-key')).toBeNull();
  });

  it('unsign rejects a value with no signature delimiter', async () => {
    expect(await unsign('no-dot-here', KEY)).toBeNull();
  });
});
