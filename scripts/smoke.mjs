// Headless smoke check for the built PWA.
//
// Serves the built `dist/` with `vite preview` (which honours base: '/Swipe-GT/'),
// loads it in the pre-installed Chromium via Playwright, and fails loudly on ANY
// error signal (console errors, uncaught exceptions / syntax errors, failed
// requests) or if the app does not actually render its Connect screen.
//
// Assumes `dist/` already exists (run `npm run build` first, or use
// `npm run smoke:build` for the one-shot build+smoke).
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}/Swipe-GT/`;

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
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for port ${port}`));
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });
}

// Find the pre-installed Chromium binary so we never rely on a downloaded one.
function findChromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const candidates = readdirSync(base)
    .filter((d) => d.startsWith('chromium-'))
    .map((d) => join(base, d, 'chrome-linux', 'chrome'))
    .filter((p) => existsSync(p));
  return candidates[0];
}

async function main() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.error('FAIL: dist/index.html not found. Run `npm run build` first.');
    process.exit(1);
  }

  // Start `vite preview` serving the built dist at the correct base path.
  // `detached: true` puts the preview in its own process group so we can kill
  // the whole tree (npx -> vite) on teardown and never orphan the child.
  const preview = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  preview.stdout.on('data', (b) => process.stdout.write(`[preview] ${b}`));
  preview.stderr.on('data', (b) => process.stderr.write(`[preview] ${b}`));

  const teardown = () => {
    try {
      // Negative PID targets the whole process group.
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
  const errors = [];
  try {
    await waitForPort(PORT);

    const { chromium } = await import('playwright');
    const executablePath = findChromiumExecutable();
    browser = await chromium.launch(
      executablePath ? { executablePath } : {},
    );
    const page = await browser.newPage();

    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`);
    });
    page.on('pageerror', (e) => {
      errors.push(`[pageerror] ${e.message}`);
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (/favicon/i.test(url)) return; // ignore favicon
      errors.push(`[requestfailed] ${url} — ${req.failure()?.errorText ?? 'unknown'}`);
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000); // short settle for async boot

    // Render assertion: <app-root> exists and its (recursive) shadow tree
    // contains a button whose text matches /connect/i, or at least a non-empty
    // shadowRoot.
    const render = await page.evaluate(() => {
      const root = document.querySelector('app-root');
      if (!root) return { hasRoot: false, hasShadow: false, hasConnect: false };
      const hasShadow = !!root.shadowRoot && root.shadowRoot.childElementCount > 0;

      // Recursively walk shadow trees looking for a button matching /connect/i.
      const matchesConnect = (node) => {
        const text = (node.textContent || '').trim();
        return /connect/i.test(text);
      };
      const search = (node) => {
        if (!node) return false;
        const els = node.querySelectorAll('*');
        for (const el of els) {
          const tag = el.tagName.toLowerCase();
          if ((tag.includes('button') || tag === 'button') && matchesConnect(el)) {
            return true;
          }
          if (el.shadowRoot && search(el.shadowRoot)) return true;
        }
        return false;
      };
      const hasConnect = search(root.shadowRoot) || search(document);
      return { hasRoot: true, hasShadow, hasConnect };
    });

    const renderOk = render.hasRoot && render.hasShadow && render.hasConnect;

    console.log('\n===== SMOKE RESULT =====');
    console.log(`app-root present:     ${render.hasRoot}`);
    console.log(`shadowRoot non-empty: ${render.hasShadow}`);
    console.log(`Connect button found: ${render.hasConnect}`);
    console.log(`captured errors:      ${errors.length}`);
    if (errors.length) {
      console.log('\n--- Captured errors (verbatim) ---');
      for (const e of errors) console.log(e);
    }

    const pass = renderOk && errors.length === 0;
    console.log(`\n${pass ? 'PASS' : 'FAIL'}: smoke check ${pass ? 'succeeded' : 'failed'}.`);
    if (!pass && !renderOk) {
      console.log('Render assertion failed: the Connect screen did not render.');
    }
    console.log('========================\n');

    await browser.close();
    browser = undefined;
    teardown();
    process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('FAIL: smoke check threw:', err);
    if (errors.length) {
      console.error('\n--- Captured errors before the throw ---');
      for (const e of errors) console.error(e);
    }
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
