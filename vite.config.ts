import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// Portable / rehostable base.
//
// `base: './'` makes Vite emit RELATIVE asset URLs, so the built `dist/` works
// unchanged at ANY mount path — `/`, `/Swipe-GT/`, `/anything/` — with no
// rebuild. This is the single source of truth for the base: nothing else in the
// codebase hardcodes `/Swipe-GT/`. See README "Rehosting / deploying elsewhere".
//
// The PWA is kept portable too: the SW's scope is simply the directory it is
// served from, and the manifest's scope/start_url/icon srcs are RELATIVE so an
// installed PWA is never pinned to `/Swipe-GT/`.
const BASE = './';

export default defineConfig({
  base: BASE,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Inherit Vite's relative base; do not pin the SW/manifest to a path.
      injectRegister: null, // we register manually in src/pwa/register.ts
      workbox: {
        // Precache the app shell (JS/CSS/HTML) plus local icons/fonts.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // SPA fallback: serve the shell for navigations while offline. Relative
        // so it resolves against the SW scope (the directory it is served from),
        // working under any mount path.
        navigateFallback: 'index.html',
        // Never let the SW answer cross-origin navigations (e.g. the GIS popup).
        navigateFallbackDenylist: [/^https?:\/\//i],
        runtimeCaching: [
          // Google Fonts stylesheets — revalidate in the background.
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Google Fonts webfont files — cache aggressively (they're immutable).
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Google Tasks API — MUST always hit the network, never cached.
          {
            urlPattern: /^https:\/\/tasks\.googleapis\.com\/.*/i,
            handler: 'NetworkOnly',
          },
          // Google Identity Services / API client — always network, never cached.
          {
            urlPattern: /^https:\/\/(accounts|apis)\.google\.com\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'Swipe GT',
        short_name: 'Swipe GT',
        description: 'Swipe through your Google Tasks that are due today or overdue.',
        theme_color: '#1a73e8',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        // Relative scope/start_url so the installed PWA is anchored to wherever
        // the manifest is served from, not a fixed `/Swipe-GT/`.
        scope: '.',
        start_url: '.',
        // Relative srcs — resolved against the manifest's own URL (dist root),
        // so they work under any mount path.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
