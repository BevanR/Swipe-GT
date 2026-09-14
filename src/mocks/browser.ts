import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

// MSW worker for optional in-browser dev use. This module is only imported from
// dev-time entry points (never from production code paths), so bundlers tree-
// shake it out of the production build. Start it from a guarded call site, e.g.:
//
//   if (import.meta.env.DEV) {
//     const { worker } = await import('./mocks/browser');
//     await worker.start();
//   }
export const worker = setupWorker(...handlers);
