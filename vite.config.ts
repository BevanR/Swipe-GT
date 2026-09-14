import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves this repo at https://bevanr.github.io/g-tasks/
// so every asset path, the SW scope, and the manifest must live under /g-tasks/.
const BASE = '/g-tasks/';

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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: `${BASE}index.html`,
      },
      manifest: {
        name: 'Google Tasks Swipe',
        short_name: 'Tasks Swipe',
        description: 'Swipe through your Google Tasks that are due today or overdue.',
        theme_color: '#1a73e8',
        background_color: '#ffffff',
        display: 'standalone',
        scope: BASE,
        start_url: BASE,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable.png',
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
