// Cloudflare Worker entry point (single origin). Serves the built Vite `dist/`
// SPA via the static-assets binding AND hosts the auth-broker API on the same
// origin, so the session cookie is first-party and there is no CORS.
//
// Routing: `wrangler.jsonc` sets `assets.run_worker_first = ["/api/*","/auth/*"]`
// so these routes reach this Worker (instead of the SPA fallback intercepting the
// navigation-looking GETs). Everything else is served by the assets binding, with
// `not_found_handling = "single-page-application"` returning index.html for any
// non-asset path (the app itself uses hash routing, so the server only ever sees
// `/` plus hashed asset URLs).

import {
  handleCallback,
  handleLogin,
  handleLogout,
  handleMe,
  handleToken,
} from './handlers';
import type { Env, ExecutionContext } from './types';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/auth/login' && request.method === 'GET') {
      return handleLogin(request, env);
    }
    if (pathname === '/auth/callback' && request.method === 'GET') {
      return handleCallback(request, env);
    }
    if (pathname === '/auth/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }
    if (pathname === '/api/token' && request.method === 'GET') {
      return handleToken(request, env);
    }
    if (pathname === '/api/me' && request.method === 'GET') {
      return handleMe(request, env);
    }

    // Any /api/* or /auth/* that didn't match a known route: 404 (do NOT fall
    // through to the SPA shell for these, or the client would parse HTML as JSON).
    if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Everything else → the static SPA (served by the assets binding).
    return env.ASSETS.fetch(request);
  },
};
