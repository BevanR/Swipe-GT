// Headless keyboard-navigation e2e for the BUILT PWA.
//
// This closes the testing gap that let keyboard bugs ship: Lit components can't
// mount in the vitest/jsdom setup, and the smoke test only exercises the
// logged-out Connect screen, so keyboard behaviour on the real list/edit/snooze
// screens was NEVER exercised. This harness boots the built `dist/` (served by
// `vite preview`, exactly like scripts/smoke.mjs) in a LOGGED-IN state with
// MOCKED Google Tasks data, then drives the keyboard and asserts the behaviours
// that would have caught the shipped bugs — crucially, that pressing Enter on a
// Postpone option applies it and returns to the LIST, never the edit screen.
//
// How "logged in + tasks" is faked, without touching app internals or Google:
//  - The app persists its OAuth token in IndexedDB (config store, key 'app') and,
//    when the token is still valid, AuthClient.getValidAccessToken() returns it
//    WITHOUT ever loading Google Identity Services. So we seed that record with a
//    far-future-expiry fake token: boot then sees `isConnected()` true and runs a
//    real load() through the normal render path.
//  - Every request to https://tasks.googleapis.com/* is intercepted via
//    Playwright's request routing and answered from in-script fixtures, so the
//    real TasksApi client, controller, partition and Lit render all run for real
//    against deterministic data — no network, no Google.
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
const PORT = 4174; // distinct from smoke's 4173 so both can run back-to-back

const resolved = await resolveConfig({ root: ROOT }, 'serve', 'production', 'production');
const BASE_PATH = resolved.base;
const BASE_URL = `http://localhost:${PORT}${BASE_PATH}`;

// --- fixtures ---------------------------------------------------------------
// Two lists; "Someday" is the designated Someday list (seeded into config).
const LISTS = [
  { id: '@default', title: 'My Tasks' },
  { id: 'SOMEDAY', title: 'Someday' },
];

// Dates chosen so membership is deterministic regardless of the machine clock:
// far-past dues are always overdue (→ Now); far-future is always Scheduled;
// dateless-in-Someday is always Someday.
const TASKS_BY_LIST = {
  '@default': [
    mkTask('task-alpha', 'Alpha task', '2020-01-01T00:00:00.000Z', '00000000000000000000'),
    mkTask('task-bravo', 'Bravo task', '2020-01-02T00:00:00.000Z', '00000000000000000001'),
    mkTask('task-charlie', 'Charlie task', undefined, '00000000000000000002'),
    mkTask('task-future', 'Future task', '2099-12-31T00:00:00.000Z', '00000000000000000003'),
  ],
  SOMEDAY: [mkTask('task-someday', 'Someday task', undefined, '00000000000000000000')],
};

// The order the Now view renders (overdue in position order, then no-date).
const NOW_TITLES = ['Alpha task', 'Bravo task', 'Charlie task'];

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

const SEED_CONFIG = {
  theme: 'tasks',
  auth: { accessToken: 'fake-e2e-token', accessTokenExpiry: Date.now() + 3600 * 1000 * 24 },
  view: 'now',
  somedayListId: 'SOMEDAY',
};

// --- server / browser plumbing (mirrors smoke.mjs) --------------------------
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

// --- browser-side helper (serialized into the page) -------------------------
// Deep-walks all shadow roots and reports the app state the assertions need.
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

  const listView = tag('task-list-view')[0];
  const cards = tag('task-card').map((c) => ({
    title: c.task ? c.task.title : '',
    selected: c.hasAttribute('selected'),
  }));
  const options = all
    .filter((el) => el.getAttribute && el.getAttribute('role') === 'option')
    .map((el) => ({
      label: el.textContent.trim(),
      selected: el.getAttribute('aria-selected') === 'true',
    }));

  // Deep active element (pierce shadow roots).
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) {
    active = active.shadowRoot.activeElement;
  }

  const helpOpen = all.some(
    (el) => el.getAttribute && el.getAttribute('aria-label') === 'Keyboard shortcuts',
  );
  const undoVisible = all.some(
    (el) => el.getAttribute && el.getAttribute('title') === 'Undo (u)',
  );

  return {
    hash: location.hash,
    editOpen: tag('edit-task-screen').length > 0,
    snoozeOpen: tag('snooze-screen').length > 0,
    listOpen: tag('task-list-view').length > 0,
    view: listView ? listView.view : null,
    cards,
    selectedTitle: (cards.find((c) => c.selected) || {}).title || null,
    options,
    selectedOption: (options.find((o) => o.selected) || {}).label || null,
    selectedOptionIndex: options.findIndex((o) => o.selected),
    helpOpen,
    undoVisible,
    activeTag: active ? active.tagName.toLowerCase() : null,
    activeType: active && active.getAttribute ? active.getAttribute('type') : null,
  };
}
/* c8 ignore stop */

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
  try {
    await waitForPort(PORT);
    const { chromium } = await import('playwright');
    const executablePath = findChromiumExecutable();
    browser = await chromium.launch(executablePath ? { executablePath } : {});
    // Block the service worker so EVERY Google Tasks fetch comes straight from
    // the page and is deterministically intercepted by page.route below (a
    // controlling SW can otherwise race the interception of its own NetworkOnly
    // passthrough fetches). We are testing keyboard behaviour, not the SW.
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();

    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`[console.error] ${m.text()}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));

    // Intercept ALL Google Tasks REST traffic and answer from fixtures.
    await page.route(/https:\/\/tasks\.googleapis\.com\/.*/, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const p = url.pathname;
      if (process.env.E2E_DEBUG) console.log('ROUTE', req.method(), p);
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

      let m;
      if ((m = p.match(/\/lists\/([^/]+)\/tasks\/([^/]+)\/move$/))) {
        return json(mkTask(m[2], 'moved', undefined, '00000000000000000099'));
      }
      if ((m = p.match(/\/lists\/([^/]+)\/tasks\/([^/]+)$/))) {
        // PATCH (snooze/complete/clear) or DELETE — echo a benign task.
        return json(mkTask(m[2], 'patched', undefined, '00000000000000000099'));
      }
      if ((m = p.match(/\/lists\/([^/]+)\/tasks$/))) {
        const listId = decodeURIComponent(m[1]);
        if (req.method() === 'POST') return json(mkTask('task-new', 'new', undefined, '00000000000000000099'));
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

    // First load boots to the Connect screen and, importantly, creates the
    // IndexedDB (with its object stores). Then seed the signed-in config into it
    // and reload so boot takes the logged-in path through the real load().
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => !!document.querySelector('app-root')?.shadowRoot, { timeout: 15000 });

    await page.evaluate(async (config) => {
      await new Promise((resolve, reject) => {
        const openReq = indexedDB.open('g-tasks', 1);
        openReq.onupgradeneeded = () => {
          const db = openReq.result;
          if (!db.objectStoreNames.contains('config')) db.createObjectStore('config');
          if (!db.objectStoreNames.contains('snapshot')) db.createObjectStore('snapshot');
          if (!db.objectStoreNames.contains('mutations')) db.createObjectStore('mutations', { keyPath: 'id' });
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
    }, SEED_CONFIG);

    await page.reload({ waitUntil: 'load', timeout: 30000 });

    // Wait until the logged-in list has rendered its cards.
    try {
      await page.waitForFunction(
        () => {
          const walk = (root, out) => {
            root.querySelectorAll('*').forEach((el) => {
              out.push(el);
              if (el.shadowRoot) walk(el.shadowRoot, out);
            });
            return out;
          };
          return walk(document, []).filter((el) => el.tagName.toLowerCase() === 'task-card').length > 0;
        },
        { timeout: 15000 },
      );
    } catch (e) {
      const dbg = await page.evaluate(pageProbe);
      console.log('DEBUG probe on card-wait timeout:', JSON.stringify(dbg));
      console.log('DEBUG console errors so far:', JSON.stringify(consoleErrors));
      throw e;
    }

    const press = async (key) => {
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
    };
    const probe = () => page.evaluate(pageProbe);
    const toList = async () => {
      await page.evaluate(() => (location.hash = '#/'));
      await page.waitForTimeout(80);
      await press('1'); // Now view
    };

    console.log('\n===== E2E KEYBOARD ASSERTIONS =====');

    // Baseline: logged-in list rendered with the expected Now tasks in order.
    let st = await probe();
    check('logged-in list renders on boot', st.listOpen && !st.editOpen && !st.snoozeOpen, JSON.stringify(st.hash));
    check(
      'Now view shows the seeded tasks in order',
      JSON.stringify(st.cards.map((c) => c.title)) === JSON.stringify(NOW_TITLES),
      JSON.stringify(st.cards.map((c) => c.title)),
    );

    // ArrowDown / ArrowUp move the selection highlight across cards.
    await press('ArrowDown');
    st = await probe();
    check('ArrowDown selects the first card', st.selectedTitle === 'Alpha task', st.selectedTitle);
    check('exactly one card selected', st.cards.filter((c) => c.selected).length === 1);
    await press('ArrowDown');
    st = await probe();
    check('ArrowDown moves to the second card', st.selectedTitle === 'Bravo task', st.selectedTitle);
    await press('ArrowUp');
    st = await probe();
    check('ArrowUp moves back to the first card', st.selectedTitle === 'Alpha task', st.selectedTitle);
    const onList = (s) => s.listOpen && !s.editOpen && !s.snoozeOpen && (s.hash === '' || s.hash === '#/');
    check('no navigation leaked (still on the list)', onList(st), st.hash);

    // 1 / 2 / 3 switch views.
    await press('2');
    st = await probe();
    check('"2" switches to the Scheduled view', st.view === 'scheduled', st.view);
    check('Scheduled view shows the future task', st.cards.some((c) => c.title === 'Future task'));
    await press('3');
    st = await probe();
    check('"3" switches to the Someday view', st.view === 'someday', st.view);
    check('Someday view shows the someday task', st.cards.some((c) => c.title === 'Someday task'));
    await press('1');
    st = await probe();
    check('"1" switches back to the Now view', st.view === 'now', st.view);

    // "?" opens help; Escape closes it.
    await press('?');
    st = await probe();
    check('"?" opens the keyboard-shortcuts help', st.helpOpen);
    await press('Escape');
    st = await probe();
    check('Escape closes the help overlay', !st.helpOpen);

    // "e" opens edit; focus lands on the Title field; Escape returns to the list.
    await toList();
    await press('ArrowDown'); // select Alpha
    await press('e');
    st = await probe();
    check('"e" opens the edit screen', st.editOpen && st.hash.startsWith('#/edit/'), st.hash);
    check('focus lands on the Title text field', st.activeTag === 'input' && st.activeType !== 'date', `${st.activeTag}/${st.activeType}`);
    await press('Escape');
    st = await probe();
    check('Escape on edit returns to the list', st.listOpen && !st.editOpen && st.hash === '#/', st.hash);

    // Enter (on the list) also opens edit.
    await toList();
    await press('ArrowDown');
    await press('Enter');
    st = await probe();
    check('Enter opens the edit screen', st.editOpen && st.hash.startsWith('#/edit/'), st.hash);
    await page.evaluate(() => (location.hash = '#/'));
    await page.waitForTimeout(80);

    // "r" (rename) opens the edit screen.
    await toList();
    await press('ArrowDown');
    await press('r');
    st = await probe();
    check('"r" opens the edit (rename) screen', st.editOpen && st.hash.startsWith('#/edit/'), st.hash);
    await page.evaluate(() => (location.hash = '#/'));
    await page.waitForTimeout(80);

    // "s", "p" and "d" all open the Postpone route.
    for (const key of ['s', 'p', 'd']) {
      await toList();
      await press('ArrowDown');
      await press(key);
      st = await probe();
      check(`"${key}" opens the Postpone route`, st.snoozeOpen && st.hash.startsWith('#/snooze/'), st.hash);
      check(`"${key}" Postpone lists options`, st.options.length > 0);
      await page.evaluate(() => (location.hash = '#/'));
      await page.waitForTimeout(80);
    }

    // THE reported bug: on the Postpone route, ArrowUp/Down move only within the
    // options, and Enter APPLIES the option and returns to the LIST — it must NOT
    // navigate to the edit screen.
    await toList();
    await press('ArrowDown'); // select Alpha
    await press('p'); // open Postpone
    st = await probe();
    check('Postpone route open with a selected option', st.snoozeOpen && st.selectedOptionIndex === 0, `${st.selectedOptionIndex}`);
    const firstOpt = st.selectedOption;
    await press('ArrowDown');
    st = await probe();
    check('ArrowDown moves within Postpone options', st.selectedOptionIndex === 1, `${st.selectedOptionIndex}`);
    await press('ArrowDown');
    st = await probe();
    check('ArrowDown moves again within options', st.selectedOptionIndex === 2, `${st.selectedOptionIndex}`);
    await press('ArrowUp');
    st = await probe();
    check('ArrowUp moves back within options', st.selectedOptionIndex === 1, `${st.selectedOptionIndex}`);
    check('option highlight actually changed from the first', st.selectedOption !== firstOpt, `${firstOpt} -> ${st.selectedOption}`);
    check('still on the Postpone route (no leak) after arrows', st.snoozeOpen && !st.editOpen, st.hash);
    await press('Enter');
    st = await probe();
    check('Enter on a Postpone option returns to the LIST', st.listOpen && st.hash === '#/', st.hash);
    check('Enter on a Postpone option did NOT open the edit screen (the shipped bug)', !st.editOpen, st.hash);

    // "c" / "x" complete the selected task (in-gap Undo affordance appears).
    await toList();
    await press('ArrowDown'); // select Alpha
    await press('c');
    st = await probe();
    check('"c" completes the selected task (Undo affordance shown)', st.undoVisible);
    await press('u'); // undo to keep state stable
    await page.waitForTimeout(120);
    st = await probe();
    check('"u" undoes the completion (card restored)', st.cards.some((c) => c.title === 'Alpha task'));

    console.log('===================================\n');

    // Console errors are a hard failure (the gate demands 0).
    for (const e of consoleErrors) console.log(e);

    const pass = failures.length === 0 && consoleErrors.length === 0;
    console.log(`captured console errors: ${consoleErrors.length}`);
    console.log(`assertion failures:      ${failures.length}`);
    console.log(`\n${pass ? 'PASS' : 'FAIL'}: keyboard e2e ${pass ? 'succeeded' : 'failed'}.`);
    if (!pass && failures.length) console.log(`Failed: ${failures.join(', ')}`);

    await browser.close();
    browser = undefined;
    teardown();
    process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('FAIL: keyboard e2e threw:', err);
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
