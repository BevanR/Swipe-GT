// Type contracts for the Cloudflare Worker backend (auth broker + static SPA).
//
// These are deliberately MINIMAL, hand-written shapes rather than the ambient
// globals from `@cloudflare/workers-types`. The SPA and the Worker share the one
// root tsconfig, whose `lib` includes "DOM"; pulling in the workers-types global
// declarations there would redefine `Request`/`Response`/`fetch` and clash with
// the DOM lib. We instead use the DOM's standard `Request`/`Response`/`crypto`
// (which also exist in the Workers runtime) and declare only the Cloudflare-
// specific bindings we actually touch (KV + the assets fetcher). The real runtime
// types are available via the `@cloudflare/workers-types` devDependency for
// `wrangler types`/editor tooling; the deployed bundle is type-checked here.

/** The minimal slice of a KV namespace binding this Worker uses. */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; expiration?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The static-assets binding (`env.ASSETS`) — a fetcher over the built `dist/`. */
export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

/** Minimal `ExecutionContext` (only `waitUntil` is used, and optionally so). */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * The Worker environment: bindings + vars + secrets declared in `wrangler.jsonc`
 * (and, for secrets, via `wrangler secret put`). Vars and secrets are injected as
 * plain strings on this object at runtime.
 */
export interface Env {
  // --- bindings ---
  /** Static assets (the built Vite `dist/`); serves the SPA shell. */
  ASSETS: AssetFetcher;
  /** KV namespace holding opaque session id → {@link SessionRecord}. */
  SESSIONS: KVNamespace;

  // --- vars (non-secret; set in wrangler.jsonc `vars`) ---
  /** Google OAuth 2.0 **Web application** client id. Public by design. */
  GOOGLE_CLIENT_ID: string;
  /** Space-delimited OAuth scope string (e.g. the Google Tasks scope). */
  OAUTH_SCOPE: string;
  /**
   * Optional explicit app origin (e.g. `https://swipe-gt.example.workers.dev`).
   * When empty, the Worker derives the origin from the incoming request, which
   * is correct for the single-origin deployment. Set it only if you front the
   * Worker with a different public origin.
   */
  APP_ORIGIN?: string;

  // --- secrets (NEVER in the repo; `wrangler secret put <NAME>`) ---
  /** Google OAuth client secret (the confidential half of the Web client). */
  GOOGLE_CLIENT_SECRET: string;
  /** HMAC key used to sign cookies. Generate a long random string. */
  COOKIE_SIGNING_KEY: string;
}

/** A persisted session: the long-lived refresh token plus a cached access token. */
export interface SessionRecord {
  /** Google refresh token — the credential that makes login permanent. */
  refreshToken: string;
  /** Most recently obtained access token (cached to avoid needless refreshes). */
  accessToken: string;
  /** Epoch ms at which {@link accessToken} expires. */
  accessTokenExpiry: number;
  /** Epoch ms the session was created (for diagnostics / future TTL policy). */
  createdAt: number;
}

/** Google's token-endpoint success response (fields we rely on). */
export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}
