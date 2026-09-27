// Headless OFFLINE-FIRST e2e for the BUILT PWA.
//
// Complements scripts/e2e-keyboard.mjs (which covers the logged-in keyboard
// flows) by exercising the offline-first auth + sync behaviour that the unit
// tests can only partially cover. It boots the built `dist/` under `vite preview`
// exactly like the keyboard harness, seeds a logged-in state, then simulates the
// real offline condition and asserts:
//
//   (a) an OFFLINE COLD LOAD renders the cached tasks and shows the Offline
//       indicator instead of bouncing to the Connect screen — the whole point of
//       the fix, even with an EXPIRED cached token (the reported failure);
//   (b) a mutation made while offline is enqueued and its task shows the per-item
//       "syncing" indicator; and
//   (c) on RECONNECT the queue drains and the syncing indicator clears.
//
// How "offline" is simulated WITHOUT killing the app shell (served from
// localhost) or the service worker:
//   - navigator.onLine is overridden (via addInitScript) to read a page flag, so
//     the app sees itself as offline exactly as the real browser would; and
//   - every request to https://tasks.googleapis.com/* is aborted (a network
//     failure), toggled from the Node side, so Google is unreachable.
// Reconnect flips both back on and dispatches the `online` event.
//
// Assumes `dist/` already exists (run `npm run build` first, or use the
// `test:e2e:build` npm script for the one-shot build+run).
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { resolveConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 4175; // distinct from smoke (4173) and keyboard e2e (4174)

const resolved = await resolveConfig({ root: ROOT }, 'serve', 'production', 'production');
const BASE_PATH = resolved.base;
const BASE_URL = `http://localhost:${PORT}${BASE_PATH}`;

// --- fixtures (same shape as the keyboard harness) --------------------------
const LISTS = [
  { id: '@default', title: 'My Tasks' },
  { id: 'SOMEDAY', title: 'Someday' },
];

const TASKS_BY_LIST = {
  '@default': [
    mkTask('task-alpha', 'Alpha task', '2020-01-01T00:00:00.000Z', '00000000000000000000'),
    mkTask('task-bravo', 'Bravo task', '2020-01-02T00:00:00.000Z', '00000000000000000001'),
    mkTask('task-charlie', 'Charlie task', undefined, '00000000000000000002'),
  ],
  SOMEDAY: [mkTask('task-someday', 'Someday task', undefined, '00000000000000000000')],
};

function mkTask(id, title, due, position) {
  return {
    kind: 'tasks#task',
    id,
    etag: `"etag-${id}"`,
    title,
    updated: '2026-09-14T12:00:00.000Z',
    selfLink: `https://tasks.googleapis.com/tasks/v1/lists/x/tasks/${id}`,
    position,
    status: 'needsAction',
    ...(due ? { due } : {}),
  };
}

// Phase 1 seed: a VALID token so the first (online) load succeeds and caches a
// snapshot. Phase 2 rewrites this with an EXPIRED token to reproduce the exact
// reported failure (offline + expired token used to bounce to Connect).
const VALID_CONFIG = {
  theme: 'tasks',
  auth: { accessToken: 'fake-e2e-token', accessTokenExpiry: Date.now() + 3600 * 1000 * 24 },
  view: 'now',
  somedayListId: 'SOMEDAY',
};
const EXPIRED_CONFIG = {
  ...VALID_CONFIG,
  auth: { accessToken: 'fake-e2e-token-expired', accessTokenExpiry: Date.now() - 1000 },
};

// --- server / browser plumbing (mirrors e2e-keyboard.mjs) -------------------
function waitForPort(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = createConnection({ port, host: 'localhost' });
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`Timed out waiting for port ${port}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function findChromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const candidates = readdirSync(base)
    .filter((d) => d.startsWith('chromium-'))
    .map((d) => join(base, d, 'chrome-linux', 'chrome'))
    .filter((p) => existsSync(p));
  return candidates[0];
}

/* c8 ignore start */
function pageProbe() {
  const all = [];
  const walk = (root) => {
    root.querySelectorAll('*').forEach((el) => {
      all.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    });
  };
  walk(document);
  const tag = (t) => all.filter((el) => el.tagName.toLowerCase() === t);
  const cards = tag('task-card').map((c) => ({
    title: c.task ? c.task.title : '',
    syncing: c.hasAttribute('syncing'),
  }));
  const offlineChip = all.some(
    (el) => el.classList && el.classList.contains('offline-chip'),
  );
  return {
    hash: location.hash,
    connectOpen: tag('connect-screen').length > 0,
    listOpen: tag('task-list-view').length > 0,
    offlineChip,
    cards,
    syncingCount: cards.filter((c) => c.syncing).length,
  };
}
/* c8 ignore stop */

function countMutations() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('g-tasks', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('mutations', 'readonly');
      const all = tx.objectStore('mutations').getAll();
      all.onsuccess = () => {
        db.close();
        resolve(all.result.length);
      };
      all.onerror = () => reject(all.error);
    };
    req.onerror = () => reject(req.error);
  });
}

function seedConfig(config) {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open('g-tasks', 1);
    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      if (!db.objectStoreNames.contains('config')) db.createObjectStore('config');
      if (!db.objectStoreNames.contains('snapshot')) db.createObjectStore('snapshot');
      if (!db.objectStoreNames.contains('mutations'))
        db.createObjectStore('mutations', { keyPath: 'id' });
    };
    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction('config', 'readwrite');
      tx.objectStore('config').put(config, 'app');
      tx.oncomplete = () => {
        db.close();
        resolve(undefined);
      };
      tx.onerror = () => reject(tx.error);
    };
    openReq.onerror = () => reject(openReq.error);
  });
}

// --- assertions -------------------------------------------------------------
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok  - ${name}`);
  } else {
    console.log(`  FAIL- ${name}${detail ? ` :: ${detail}` : ''}`);
    failures.push(name);
  }
}

const walkCards = () => {
  const w = (root, out) => {
    root.querySelectorAll('*').forEach((el) => {
      out.push(el);
      if (el.shadowRoot) w(el.shadowRoot, out);
    });
    return out;
  };
  return w(document, []).filter((el) => el.tagName.toLowerCase() === 'task-card').length;
};

async function main() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.error('FAIL: dist/index.html not found. Run `npm run build` first.');
    process.exit(1);
  }

  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  preview.stdout.on('data', (b) => process.stdout.write(`[preview] ${b}`));
  preview.stderr.on('data', (b) => process.stderr.write(`[preview] ${b}`));

  const teardown = () => {
    try {
      process.kill(-preview.pid, 'SIGTERM');
    } catch {
      try {
        preview.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  };

  let browser;
  const consoleErrors = [];
  // Node-side flag toggling whether Google is reachable (network up/down).
  let googleReachable = true;

  try {
    await waitForPort(PORT);
    const { chromium } = await import('playwright');
    const executablePath = findChromiumExecutable();
    browser = await chromium.launch(executablePath ? { executablePath } : {});
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();

    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      // Deliberately simulating offline aborts every Google request, which the
      // browser logs as a failed resource load. That noise is an artifact of the
      // harness (not an app error), so ignore ONLY those; everything else is a
      // hard failure exactly as in the keyboard harness.
      if (/ERR_FAILED|Failed to load resource|net::ERR/i.test(text)) return;
      consoleErrors.push(`[console.error] ${text}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));

    // Intercept all Google Tasks REST traffic: abort when "offline", else answer
    // from fixtures (so the online seed load succeeds and drains work on reconnect).
    await page.route(/https:\/\/tasks\.googleapis\.com\/.*/, async (route) => {
      if (!googleReachable) return route.abort('failed');
      const req = route.request();
      const url = new URL(req.url());
      const p = url.pathname;
      const json = (body) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      let m;
      if ((m = p.match(/\/lists\/([^/]+)\/tasks\/([^/]+)\/move$/))) {
        return json(mkTask(m[2], 'moved', undefined, '00000000000000000099'));
      }
      if ((m = p.match(/\/lists\/([^/]+)\/tasks\/([^/]+)$/))) {
        return json(mkTask(m[2], 'patched', undefined, '00000000000000000099'));
      }
      if ((m = p.match(/\/lists\/([^/]+)\/tasks$/))) {
        const listId = decodeURIComponent(m[1]);
        if (req.method() === 'POST')
          return json(mkTask('task-new', 'new', undefined, '00000000000000000099'));
        return json({ kind: 'tasks#tasks', items: TASKS_BY_LIST[listId] ?? [] });
      }
      if (p.match(/\/users\/@me\/lists$/)) {
        return json({
          kind: 'tasks#taskLists',
          items: LISTS.map((l) => ({ kind: 'tasks#taskList', etag: `"e-${l.id}"`, ...l })),
        });
      }
      return json({});
    });

    console.log('\n===== E2E OFFLINE ASSERTIONS =====');

    // --- Phase 1: online seed (creates the IndexedDB + caches a snapshot) -----
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => !!document.querySelector('app-root')?.shadowRoot, {
      timeout: 15000,
    });
    await page.evaluate(seedConfig, VALID_CONFIG);
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(walkCards, { timeout: 15000 });
    let st = await page.evaluate(pageProbe);
    check('online seed load renders the list', st.listOpen && !st.connectOpen);
    check('online seed shows NO offline indicator', !st.offlineChip);

    // --- Phase 2: OFFLINE COLD LOAD with an EXPIRED token --------------------
    // Rewrite the token to expired (the reported failure), then go offline: force
    // navigator.onLine=false and make Google unreachable, and reload.
    await page.evaluate(seedConfig, EXPIRED_CONFIG);
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => window.__online === true,
      });
    });
    googleReachable = false;
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    // The cached list should render from the snapshot (NOT the connect screen).
    try {
      await page.waitForFunction(walkCards, { timeout: 15000 });
    } catch (e) {
      const dbg = await page.evaluate(pageProbe);
      console.log('DEBUG offline-cold-load probe:', JSON.stringify(dbg));
      throw e;
    }
    st = await page.evaluate(pageProbe);
    check(
      'OFFLINE COLD LOAD renders cached tasks (not the Connect screen)',
      st.listOpen && !st.connectOpen,
      JSON.stringify({ list: st.listOpen, connect: st.connectOpen }),
    );
    check(
      'offline cold load shows the cached Alpha task',
      st.cards.some((c) => c.title === 'Alpha task'),
      JSON.stringify(st.cards.map((c) => c.title)),
    );
    check('offline cold load shows the Offline indicator', st.offlineChip);

    // --- Phase 3: mutate while offline → enqueued + syncing indicator --------
    const press = async (key) => {
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
    };
    // Select Alpha (overdue → Now) and snooze it to "Today" (option 0), which
    // keeps it in the Now view so its card stays visible with the indicator.
    await page.evaluate(() => (location.hash = '#/'));
    await page.waitForTimeout(80);
    await press('1'); // Now view
    await press('ArrowDown'); // select Alpha
    await press('p'); // open Postpone
    await press('Enter'); // apply "Today" while offline
    await page.waitForTimeout(200);

    const queued = await page.evaluate(countMutations);
    check('offline snooze is enqueued in the mutation queue', queued === 1, `queued=${queued}`);
    st = await page.evaluate(pageProbe);
    check(
      'the queued task shows the per-item syncing indicator',
      st.syncingCount >= 1,
      `syncingCount=${st.syncingCount}`,
    );
    check('still on the list (offline mutation did not bounce us out)', st.listOpen && !st.connectOpen);

    // --- Phase 4: RECONNECT → queue drains, indicator clears -----------------
    // Restore a valid token to stand in for a successful silent renew on
    // reconnect (headless can't drive the real GIS popup); the drain then uses a
    // fresh token, exactly as it would after a real renew.
    await page.evaluate(seedConfig, VALID_CONFIG);
    googleReachable = true;
    await page.evaluate(() => {
      window.__online = true;
      window.dispatchEvent(new Event('online'));
    });
    // Wait for the drain + refresh to settle (queue emptied).
    try {
      await page.waitForFunction(
        () =>
          new Promise((resolve) => {
            const req = indexedDB.open('g-tasks', 1);
            req.onsuccess = () => {
              const db = req.result;
              const all = db.transaction('mutations', 'readonly').objectStore('mutations').getAll();
              all.onsuccess = () => {
                db.close();
                resolve(all.result.length === 0);
              };
              all.onerror = () => resolve(false);
            };
            req.onerror = () => resolve(false);
          }),
        { timeout: 15000 },
      );
    } catch (e) {
      const dbg = await page.evaluate(pageProbe);
      const q = await page.evaluate(countMutations);
      console.log('DEBUG reconnect probe:', JSON.stringify(dbg), 'queued=', q);
      throw e;
    }
    await page.waitForTimeout(200);
    const drained = await page.evaluate(countMutations);
    check('on reconnect the offline queue drains', drained === 0, `queued=${drained}`);
    st = await page.evaluate(pageProbe);
    check('after reconnect the syncing indicator clears', st.syncingCount === 0, `syncingCount=${st.syncingCount}`);
    check('after reconnect the Offline indicator clears', !st.offlineChip);

    console.log('==================================\n');

    for (const e of consoleErrors) console.log(e);
    const pass = failures.length === 0 && consoleErrors.length === 0;
    console.log(`captured console errors: ${consoleErrors.length}`);
    console.log(`assertion failures:      ${failures.length}`);
    console.log(`\n${pass ? 'PASS' : 'FAIL'}: offline e2e ${pass ? 'succeeded' : 'failed'}.`);
    if (!pass && failures.length) console.log(`Failed: ${failures.join(', ')}`);

    await browser.close();
    browser = undefined;
    teardown();
    process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('FAIL: offline e2e threw:', err);
    if (consoleErrors.length) for (const e of consoleErrors) console.error(e);
    process.exit(1);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
    teardown();
  }
}

main();
