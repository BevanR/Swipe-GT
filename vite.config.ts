import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves this repo at https://bevanr.github.io/Swipe-GT/
// so every asset path, the SW scope, and the manifest must live under /Swipe-GT/.
const BASE = '/Swipe-GT/';

export default defineConfig({
  base: BASE,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Keep the SW and its scope under the app base path.
      base: BASE,
      scope: BASE,
      injectRegister: null, // we register manually in src/pwa/register.ts
      workbox: {
        // Precache the app shell (JS/CSS/HTML) plus local icons/fonts.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // SPA fallback: serve the shell for navigations while offline.
        navigateFallback: `${BASE}index.html`,
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
        scope: BASE,
        start_url: BASE,
        // Absolute, base-prefixed srcs so they resolve under /g-tasks/ regardless
        // of the manifest's own URL.
        icons: [
          { src: `${BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: `${BASE}icons/icon-maskable-512.png`,
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
