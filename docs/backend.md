# Backend: Cloudflare Worker auth broker (permanent login)

This document describes the **optional** Cloudflare Worker backend that gives Swipe
GT **permanent login** (no more hourly/weekly re-auth), and the exact setup the
user must do to deploy it. The default GitHub Pages build is unchanged and uses no
backend; the Worker is a separate, single-origin deployment target.

Nothing secret is in the repo. The two secrets (Google client secret + cookie
signing key) are Cloudflare secrets only.

## Why

The GitHub Pages build uses Google Identity Services (GIS) in the browser, which
only yields **short-lived access tokens** and cannot hold a **refresh token**
(that needs a confidential client secret, which must never ship to a browser). So
the user re-consents roughly weekly. The broker moves the OAuth exchange to a tiny
server that safely holds the refresh token and mints access tokens on demand, so
the user stays logged in.

## Architecture (single origin)

One Cloudflare Worker serves **both** the built PWA and the auth API from the same
origin, so the session cookie is first-party and there is **no CORS**.

```
Browser ──┬─ GET /                 → Worker ASSETS binding → dist/index.html (the SPA)
          ├─ GET /assets/*.js|css  → Worker ASSETS binding → hashed assets
          ├─ GET  /auth/login      → Worker → 302 to Google consent (PKCE + state)
          ├─ GET  /auth/callback   → Worker → exchange code → store refresh token in KV
          │                                   → set httpOnly session cookie → 302 /
          ├─ GET  /api/token       → Worker → cached access token, or refresh → {access_token}
          ├─ POST /auth/logout     → Worker → delete KV session + clear cookies
          └─ GET  /api/me          → Worker → {connected: true|false}
```

- Static assets are served by the Workers **static-assets binding** (`env.ASSETS`),
  with `not_found_handling: "single-page-application"` (any non-asset path returns
  `index.html` — the app uses hash routing, so the server only ever sees `/` plus
  hashed asset URLs).
- `assets.run_worker_first: ["/api/*", "/auth/*"]` makes the Worker handle those
  routes **before** the SPA fallback. This is required: without it, the
  navigation-style `GET /auth/login` would be served `index.html` instead of
  invoking the Worker.

Code lives in `worker/`:

| File | Responsibility |
|---|---|
| `worker/index.ts` | `fetch` entry: route `/auth/*` + `/api/*`, else `env.ASSETS.fetch` |
| `worker/handlers.ts` | the five endpoint handlers (login/callback/token/logout/me) |
| `worker/oauth.ts` | Google authorization-URL build, code exchange, refresh |
| `worker/crypto.ts` | base64url, PKCE (S256), random tokens, HMAC cookie sign/verify, constant-time compare |
| `worker/cookies.ts` | cookie parse/serialize + cookie-name constants |
| `worker/types.ts` | `Env` (bindings + vars + secrets), `SessionRecord`, token types |

### Sessions, refresh tokens, and cookies

- On `/auth/callback`, the Worker exchanges the code for `{access_token,
  refresh_token, expires_in}` and stores a **`SessionRecord`** in the `SESSIONS`
  KV namespace under an opaque random key (`session:<id>`): the **refresh token**
  plus the cached access token and its expiry.
- It sets three cookies (`Path=/; SameSite=Lax`, `Secure` on https):
  - **`gt_session`** — httpOnly, HMAC-**signed**, holds the opaque session id. Page
    JS can **never** read it.
  - **`gt_oauth`** — httpOnly, signed, short-lived (10 min). Holds the in-flight
    PKCE verifier + CSRF `state` between `/auth/login` and `/auth/callback`;
    cleared on callback.
  - **`gt_connected=1`** — **readable** (not httpOnly) boolean hint, no secret. Lets
    the SPA boot know a session exists so it goes straight to loading instead of
    the Connect screen (security never depends on it).
- `/api/token` returns the cached access token while it is still valid; otherwise
  it refreshes via Google using the stored refresh token, re-caches, and returns
  the new token. It returns **401** when there is no/invalid session or when
  Google rejects the refresh (revoked/expired) — the SPA treats 401 as "reconnect".

### Security

PKCE (S256) on the code exchange; `state` verified on callback (CSRF); session id
is high-entropy and opaque (KV lookup, not guessable); cookies are HMAC-signed and
verified with a **constant-time** compare; the session cookie is httpOnly; secrets
live only in Cloudflare.

## SPA auth-mode switch

The app picks its auth client from `VITE_AUTH_MODE` (`src/config.ts`):

- unset / anything but `broker` → **`gis`** (current behavior; GitHub Pages + all
  existing tests). Default, so nothing breaks.
- `broker` → the Cloudflare backend (`src/auth/brokerAuthClient.ts`):
  - `connect()` → full-page redirect to `/auth/login`.
  - `getValidAccessToken()` → `fetch('/api/token', {credentials:'include'})`; 200 →
    cache + return; 401 → the existing `SilentRenewFailedError` ("reconnect") path.
    **Offline** it does NOT call `/api/token` — it reuses the cached token (same
    offline-first `decideTokenStrategy` the GIS client uses) so the snapshot
    renders.
  - `disconnect()` → `POST /auth/logout`, then clear local state.

The Cloudflare build sets `VITE_AUTH_MODE=broker`; the GitHub Pages build leaves it
unset.

---

## Setup checklist (what the user must do)

There is a **chicken-and-egg**: you need the Worker's URL to register it in Google,
but you need to deploy to learn the URL. So the order is: **deploy → learn URL →
register in Google → set secrets → redeploy.**

### 1. First deploy (to learn the Worker URL)

```sh
npm install                       # ensure wrangler + workers-types are installed
npm run build                     # builds the SPA to dist/
npx wrangler kv namespace create SESSIONS
```

Copy the printed namespace **id** into `wrangler.jsonc` → `kv_namespaces[0].id`
(replace `TODO_PUT_YOUR_KV_NAMESPACE_ID_HERE`). Then:

```sh
npx wrangler deploy
```

Wrangler prints the Worker URL, e.g. `https://swipe-gt.<your-subdomain>.workers.dev`.
Note it — this is `<WORKER_URL>` below.

### 2. Create the Google OAuth **Web application** client

In Google Cloud Console → **APIs & Services → Credentials → Create credentials →
OAuth client ID → Application type: _Web application_**. (This is a *different*
client type from the GitHub Pages GIS one — a Web client has a **client secret**.)

- **Authorized JavaScript origins:** `<WORKER_URL>`
- **Authorized redirect URIs:** `<WORKER_URL>/auth/callback` (must match exactly)

Save. Copy the **Client ID** and **Client secret**.

Put the client id in `wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID` (replace the TODO).
Make sure the Tasks scope is on the OAuth consent screen and the signing-in Google
account is a **test user** (see verification note below).

### 3. Set the two secrets

```sh
npx wrangler secret put GOOGLE_CLIENT_SECRET      # paste the Web client secret
npx wrangler secret put COOKIE_SIGNING_KEY        # paste a long random string
```

Generate a cookie signing key (any of):

```sh
openssl rand -base64 48
# or
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 4. Build the SPA in broker mode and redeploy

```sh
VITE_AUTH_MODE=broker npm run build
npx wrangler deploy
```

(On Windows PowerShell: `$env:VITE_AUTH_MODE="broker"; npm run build`.)

Visit `<WORKER_URL>`, click **Connect Google Tasks**, consent once — you should
stay logged in thereafter.

### Config summary

| Where | Name | Value |
|---|---|---|
| `wrangler.jsonc` `vars` | `GOOGLE_CLIENT_ID` | the **Web** client id |
| `wrangler.jsonc` `vars` | `OAUTH_SCOPE` | `https://www.googleapis.com/auth/tasks` (default) |
| `wrangler.jsonc` `vars` | `APP_ORIGIN` | empty (derive from request) unless fronted by another origin |
| `wrangler.jsonc` `kv_namespaces` | `SESSIONS` id | from `wrangler kv namespace create` |
| secret | `GOOGLE_CLIENT_SECRET` | the Web client secret |
| secret | `COOKIE_SIGNING_KEY` | a long random string you generate |
| build env | `VITE_AUTH_MODE` | `broker` for the Cloudflare build |

### Commands

| Command | What it does |
|---|---|
| `npm run build` | build the SPA to `dist/` (set `VITE_AUTH_MODE=broker` for the broker build) |
| `npx wrangler kv namespace create SESSIONS` | create the session KV namespace |
| `npx wrangler secret put <NAME>` | set a secret (GOOGLE_CLIENT_SECRET, COOKIE_SIGNING_KEY) |
| `npx wrangler deploy` | deploy the Worker + assets |
| `npx wrangler tail` | live-tail logs (debugging) |

## Google verification caveat (important)

While the Google OAuth app is in **Testing** publishing status, refresh tokens
**expire after ~7 days** — so "permanent" login lasts about a week until you move
the app to **Production**. Moving a **sensitive** scope (Google Tasks is sensitive)
to Production triggers Google's **verification** process. For truly permanent login
you must publish to Production and complete verification; until then, keep the
signing-in account added as a **test user** and expect weekly re-consent.

## Tests

Worker logic is unit-tested in `worker/*.test.ts` (run by the normal `vitest` gate,
Node environment, Google's token endpoint mocked via `fetch`): authorization-URL
construction (PKCE + state), code exchange success/failure, `/api/token`
cached-vs-refresh + 401 on missing/invalid session and on refresh rejection, cookie
sign/verify + tamper rejection, and state-mismatch/logout. The broker SPA client is
tested in `src/auth/brokerAuthClient.test.ts`. The default-mode (`gis`) build keeps
the existing `smoke:build` + `test:e2e:build` gate green.
