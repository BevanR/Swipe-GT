import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** MSW server for Node/Vitest tests. Lifecycle is wired in test/setup.ts. */
export const server = setupServer(...handlers);
