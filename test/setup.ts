// Vitest global setup. Runs before each test file in the jsdom environment
// (see `vite.config.ts` -> test.setupFiles).
//
// Wires the Mock Service Worker (msw) node-server lifecycle and resets the
// mock's in-memory database between tests so API tests are isolated.
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../src/mocks/server';
import { resetMockDb } from '../src/mocks/handlers';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  resetMockDb();
});

afterAll(() => {
  server.close();
});
