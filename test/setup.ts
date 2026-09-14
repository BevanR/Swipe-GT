// Vitest global setup. Runs once before each test file in the jsdom
// environment (see `vite.config.ts` -> test.setupFiles).
//
// Feature agents wire cross-cutting test concerns here, e.g.:
//   - Mock Service Worker (msw) server lifecycle: beforeAll/afterEach/afterAll
//   - @testing-library/dom cleanup between tests
//
// Intentionally empty for the foundation wave.
export {};
