// Crypto helpers for the auth broker: base64url, random tokens, PKCE, and HMAC
// cookie signing. Everything uses the Web Crypto API (`crypto.subtle` +
// `crypto.getRandomValues`) and `TextEncoder`, which are available both in the
// Cloudflare Workers runtime and in Node (used by the unit tests). No Node-only
// APIs (no `Buffer`) so the same code runs in both.

/** Encode raw bytes as URL-safe base64 (no padding) — RFC 4648 §5 / RFC 7636. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a URL-safe base64 string (no padding) back to bytes. */
export function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** A cryptographically random URL-safe token of `byteLength` bytes (default 32). */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Generate a PKCE code verifier: a high-entropy URL-safe string (RFC 7636 §4.1
 * requires 43–128 chars; 32 random bytes → 43 base64url chars).
 */
export function generateCodeVerifier(): string {
  return randomToken(32);
}

/**
 * Derive the PKCE code challenge from a verifier using the `S256` method:
 * base64url(SHA-256(ASCII(verifier))). This is what we send to Google as
 * `code_challenge` (with `code_challenge_method=S256`).
 */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Import an HMAC-SHA256 signing key from a secret string. */
async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Compute the base64url HMAC-SHA256 of `value` under `secret`. */
export async function hmacSign(value: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(sig));
}

/**
 * Constant-time string comparison. Avoids leaking, via timing, how many leading
 * characters of a candidate signature matched. Compares every character of equal-
 * length strings; unequal lengths short-circuit (length is not itself secret).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Wrap a value with a detached HMAC signature: `"<value>.<sig>"`. The value is
 * recoverable (it is not encrypted) but cannot be tampered with without the key.
 */
export async function sign(value: string, secret: string): Promise<string> {
  const sig = await hmacSign(value, secret);
  return `${value}.${sig}`;
}

/**
 * Verify a `"<value>.<sig>"` string and return the value, or `null` if the
 * signature is missing/invalid (checked in constant time).
 */
export async function unsign(signed: string, secret: string): Promise<string | null> {
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = await hmacSign(value, secret);
  return timingSafeEqual(sig, expected) ? value : null;
}
