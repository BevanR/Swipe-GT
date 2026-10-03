// Cookie parsing + serialization for the auth broker.
//
// Cookie names:
//  - `gt_session`  — httpOnly, Secure, SameSite=Lax, signed. Holds the opaque
//                    session id. JS on the page can NEVER read it.
//  - `gt_oauth`    — httpOnly, Secure, SameSite=Lax, signed, short Max-Age.
//                    Holds the in-flight PKCE verifier + state between /auth/login
//                    and /auth/callback.
//  - `gt_connected`— readable (NOT httpOnly) boolean hint "1". Carries no secret;
//                    it only lets the SPA's boot know a broker session exists so
//                    it can go straight to loading instead of the Connect screen.
//                    Security never depends on it (the httpOnly session cookie is
//                    the real credential).

export const SESSION_COOKIE = 'gt_session';
export const OAUTH_COOKIE = 'gt_oauth';
export const CONNECTED_HINT_COOKIE = 'gt_connected';

/** Parse a `Cookie:` header into a name→value map (values are URL-decoded). */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const value = part.slice(eq + 1).trim();
    out[name] = decodeURIComponent(value);
  }
  return out;
}

export interface CookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
}

/** Serialize a `Set-Cookie` header value (name URL-encoded value + attributes). */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const { maxAge, httpOnly, secure, sameSite = 'Lax', path = '/' } = options;
  let out = `${name}=${encodeURIComponent(value)}`;
  out += `; Path=${path}`;
  out += `; SameSite=${sameSite}`;
  if (typeof maxAge === 'number') out += `; Max-Age=${Math.floor(maxAge)}`;
  if (httpOnly) out += '; HttpOnly';
  if (secure) out += '; Secure';
  return out;
}

/** A `Set-Cookie` value that immediately expires (clears) a cookie. */
export function clearCookie(name: string, options: CookieOptions = {}): string {
  return serializeCookie(name, '', { ...options, maxAge: 0 });
}
