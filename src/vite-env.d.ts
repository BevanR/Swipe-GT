/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Google OAuth 2.0 Web client ID (ends `.apps.googleusercontent.com`). */
  readonly VITE_GOOGLE_CLIENT_ID: string;
  /**
   * Auth mode: `'broker'` uses the Cloudflare Worker backend; anything else
   * (including unset) uses the browser-only GIS token flow. See `src/config.ts`.
   */
  readonly VITE_AUTH_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
