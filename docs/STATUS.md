# Swipe GT — project status

A static, installable PWA that shows Google Tasks (due today / overdue / no-date)
as a swipeable list. Swipe right to complete, swipe left to snooze. Browser-only
auth via Google Identity Services (no backend). Deployed to GitHub Pages at
**https://bevanr.github.io/Swipe-GT/**.

This doc is the durable handoff for humans and future agents. Keep it current.

## How to run / verify

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (http://localhost:5173) |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run test` | Vitest unit tests (jsdom + MSW) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke:build` | Build, then load the built site in headless Chromium and fail on any console error / uncaught exception / non-render |
| `npm run icons` | Regenerate PWA icons from `public/icons/icon.svg` (sharp) |

## Deploy

- Push to `main` → `.github/workflows/deploy.yml` runs: build → **smoke gate** → publish to GitHub Pages.
- The smoke gate (headless Chromium) blocks a broken bundle from ever deploying. If it fails, nothing publishes.
- Pages must be set to **Settings → Pages → Source: GitHub Actions** (one-time, already done).
- **Path-portable / rehostable.** Vite `base` is `'./'` (relative) — the single source of truth for the base. The built `dist/` works at ANY mount path (`/`, `/Swipe-GT/`, `/anything/`) with no rebuild: asset URLs, the PWA manifest (`scope`/`start_url`/icons), the SW registration + scope + precache + `navigateFallback` are all relative. A repo rename or host/subpath move needs **nothing set**. `scripts/smoke.mjs` derives the base from Vite's resolved config, so it follows the base automatically. A new host must have its origin added to the OAuth client (see Auth below). See README "Rehosting / deploying elsewhere". (Verified: built once, served from a plain static server at `/some-other-path/` — app rendered, 0 console errors, all assets 200, SW scope anchored to the subpath.)
- Current workflow while iterating: **direct commits to `main`** (single agent). Switch to **branch + PR per agent** whenever more than one agent touches code concurrently.

## Auth / Google setup

- OAuth **client ID is public by design** and committed as the default in `src/config.ts` (overridable via `VITE_GOOGLE_CLIENT_ID`). **No client secret exists** — the GIS token flow doesn't use one.
- Scope: `https://www.googleapis.com/auth/tasks` only.
- The Google Cloud OAuth app stays in **Testing** mode; users must be added as **test users** before they can sign in. Publishing to production would trigger Google verification for the sensitive Tasks scope — avoid.
  - **Add test users here:** https://console.cloud.google.com/auth/audience?project=bevanrs-g-tasks-alt-ui (Console → APIs & Services → OAuth consent screen → Audience → Test users). Add the exact Google account that will sign in.
  - Google Cloud project: `bevanrs-g-tasks-alt-ui`.
- Authorized JS origins on the OAuth client: `https://bevanr.github.io` and `http://localhost:5173`.
- Silent-refresh only (~weekly interactive re-auth). No refresh token.

## Architecture

Static site, Vite + TypeScript (strict) + Lit 3 + Material Web. Google Tasks API
is the single source of truth; local storage is minimized.

```
src/
  config.ts            GOOGLE_CLIENT_ID (public default), OAUTH_SCOPE
  types.ts             shared types (Task, TaskList, AppConfig, SnoozeOption, ViewName, ...)
  auth/authClient.ts   GIS token client wrapper; silent renew; SilentRenewFailedError
  storage/db.ts        IndexedDB (idb): config, snapshot, mutation queue
  api/tasksApi.ts      Google Tasks REST client (lists, tasks, patch due, complete)
  logic/
    filter.ts          filterAndGroup -> {overdue, today, noDate}; excludes completed
    snooze.ts          computeSnoozeOptions(today, {overdue}) -> snooze menu options
    dueLabel.ts        formatDueLabel -> relative words within +/-7d, else "Tuesday 15 Sep"; never ISO
  pwa/
    offlineQueue.ts    drainQueue replays queued mutations oldest-first
    register.ts        service worker registration
  app/
    controller.ts      owns data flow: auth, fetch, filter, optimistic mutations,
                       offline queue, refresh triggers, star, view; emits 'change'
    state.ts           AppState (allTasks, grouped, view, starredIds, screen, ...)
  ui/
    app-root.ts        shell: subscribes to controller, switches screens
    task-list-view.ts  header (title, view switcher, refresh, settings), flat list
    task-card.ts       swipeable row: title/due/list, leading complete circle, right star
    snooze-menu.ts     Material dialog of snooze options
    connect-screen.ts  "Connect Google Tasks"
    settings-screen.ts theme toggle, per-list inclusion, disconnect
  styles/theme.css     per-theme tokens (inbox / tasks; light + dark)
  mocks/               MSW handlers + fixtures (tests only)
scripts/
  smoke.mjs            headless-Chromium smoke check (also the CI gate)
  generate-icons.mjs   SVG -> PNG icons via sharp
```

## Locked-in decisions (do not re-litigate)

- **GitHub Pages**, static only. No backend, no serverless. Base is **relative (`'./'`)** so the build is path-portable (rehostable at any path/host with no rebuild); it currently deploys to `https://bevanr.github.io/Swipe-GT/` but is not pinned to that path.
- **GIS token flow**, silent-refresh only, no refresh token, no client secret.
- Scope `auth/tasks` only.
- **TypeScript experimental decorators** (`experimentalDecorators: true`, `useDefineForClassFields: false`), Lit components use `@customElement`/`@property`/`@state` **without** the `accessor` keyword. Vite 8 transpiles via rolldown/Oxc, which does **not** lower standard decorators/`accessor` — using them ships raw syntax that crashes the browser (blank page). This is why the smoke gate exists.
- List inclusion: all lists included by default; new lists always default-included, never auto-excluded.
- Local state only for what has no home in Google's model: `auth`, `listInclusion`, `theme`, `starredTaskIds`, `view`, and the offline mutation queue. Task data itself is never a durable store — fetched fresh; `snapshot` is a disposable cache for offline render only.

## Features built

- Connect / silent renew / disconnect.
- Fetch included lists' non-completed tasks; filter/group; render.
- Three views (header switcher, persisted in `config.view`):
  - **default** — overdue + today + no-date, overdue first with orange/warning styling.
  - **starred** — locally-starred tasks (star is **local only**; the Google Tasks API has no starred field).
  - **future** — tasks due after today, ascending.
- Flat list, full-bleed rows, no group headers.
- Card: title (primary), due label (secondary, via `formatDueLabel`, never ISO), list name (tertiary/muted). Overdue → orange.
- Swipe right = complete (green + check, optimistic). Leading circle also completes.
- Swipe left = snooze menu (Tomorrow / Later this week / This weekend / Next week / Next month; **Today** added for overdue items). Right-side star toggles.
- Optimistic UI with offline enqueue + rollback; drain on reconnect.
- Two themes (inbox / tasks), PWA installable, offline app shell.

## Backlog (not yet built)

Later / needs design:
- **Drag-drop reorder** of no-date tasks (persist to Google via `move`).
- **Desktop view** — broader deliberate design pass (mobile-first today; Inbox theme reads well on desktop).
- Dark-mode visual polish.

Blocked by the public Google Tasks API (would need Google to expose it, or a backend proxying the private API — out of scope for this static PWA):
- **Recurring-task loop icon** and **hiding "Someday" on repeating tasks** — the API exposes no recurrence field. We only learn a task is recurring when Google *rejects* the cross-list move; that failure now shows a clear toast.
- **Due time-of-day** (showing/selecting a time) — the API stores date only and normalizes any time to midnight.
- **Star** — removed. The API has no starred field; Google's native star uses a private API. Revisit only if Google exposes it publicly.

Done since v1: relative/friendly dates, Scheduled bucketing, star removal, Inbox-theme fix, cog centering, add-task FAB, snooze RHS button, mobile density, Material serif-font fix, broaden "Today", client-side search, Someday list + three-view model (Now/Scheduled/Someday), list name off cards, cheerful stable empty states, add-task route (full-viewport, due dropdown incl. Someday, action in header), edit-task route (tap to edit; title/notes/due/move/delete), "Pick a date" everywhere (opens picker directly), postpone bottom-sheet, "No date" postpone, dark-mode dropdown fix, Scheduled per-card dates only in range buckets, instant optimistic cross-view moves, snappy + reduced-motion, undo-in-the-gap on complete, desktop keyboard shortcuts + selection + help overlay.

Open decisions the user may revisit: "No date" on a Someday-list task keeps it in Someday (doesn't move it out); the edit screen has a Delete action.

## Testing notes

- Unit tests colocated as `*.test.ts` (Vitest, jsdom, MSW). Pure logic (filter, snooze, dueLabel) has thorough date-boundary coverage.
- Lit components can't be DOM-mounted in the current Vitest setup (decorator/transform limitation); component behavior is covered via the controller data-flow tests + the headless smoke check instead.
- The smoke check exercises the logged-out connect path only (no real Google login in CI). Real-task rendering is confirmed by manual use with a test-user account.
