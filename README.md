# Google Tasks Swipe

A static, browser-only Progressive Web App that shows your Google Tasks that are
**due today, overdue, or have no date** as a swipeable list:

- **Swipe right** = complete the task.
- **Swipe left** = open the snooze menu (tomorrow, later this week, this weekend,
  next week, next month).

Two themes ("inbox" and "tasks"). No backend — authentication is done entirely
in the browser via Google Identity Services (GIS), and data is fetched directly
from the Google Tasks REST API. Deployed to GitHub Pages at:

**https://bevanr.github.io/g-tasks/**

---

## Tech stack

- [Vite](https://vitejs.dev/) + TypeScript (strict)
- [`@material/web`](https://github.com/material-components/material-web) — Material Web Components (Lit)
- [`idb`](https://github.com/jakearchibald/idb) — IndexedDB wrapper
- [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/) — service worker (Workbox)
- [Vitest](https://vitest.dev/) + [`@testing-library/dom`](https://testing-library.com/) + [MSW](https://mswjs.io/) — tests (jsdom env)
- Google Identity Services (GIS) token client — loaded at runtime from
  `https://accounts.google.com/gsi/client` (not bundled)

## Project layout

```
src/
  main.ts            App entry — mounts #app.
  config.ts          Reads VITE_GOOGLE_CLIENT_ID + the OAuth scope.
  types.ts           Shared type contracts (single source of truth).
  auth/authClient.ts GIS token-client wrapper.
  storage/db.ts      IndexedDB access (config, snapshot, mutation queue).
  api/tasksApi.ts    Google Tasks REST client.
  logic/filter.ts    Filter + group tasks (overdue / today / noDate).
  logic/snooze.ts    Compute snooze menu options.
  pwa/offlineQueue.ts Offline mutation queue drain.
  pwa/register.ts    Service worker registration.
  ui/                UI components (feature work).
  mocks/             MSW handlers (feature work).
test/                Vitest setup + tests.
```

> Foundation note: most `src` modules are typed stubs whose bodies throw
> `new Error('not implemented')`. They define the contract; feature work fills
> them in.

## Local development

```bash
npm install
cp .env.example .env      # then paste your real client ID (see below)
npm run dev               # Vite dev server at http://localhost:5173
```

Other scripts:

```bash
npm run build       # tsc --noEmit && vite build  -> dist/
npm run preview     # preview the production build
npm run test        # vitest run
npm run test:watch  # vitest (watch mode)
npm run typecheck   # tsc --noEmit
```

## Environment variables

| Variable                 | Description                                                        |
| ------------------------ | ----------------------------------------------------------------- |
| `VITE_GOOGLE_CLIENT_ID`  | Google OAuth 2.0 **Web** client ID (`…apps.googleusercontent.com`) |

Copy `.env.example` to `.env` and fill it in. Do **not** commit `.env`.

## Google OAuth setup

To obtain `VITE_GOOGLE_CLIENT_ID`:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create or select a project.
2. Enable the **Google Tasks API**: *APIs & Services → Library →* search
   "Google Tasks API" → **Enable**.
3. Configure the **OAuth consent screen**: *APIs & Services → OAuth consent
   screen*. Choose **External**, add the scope
   `https://www.googleapis.com/auth/tasks`, and — while the app is in **Testing**
   — add your own Google account under **Test users**.
4. Create the credential: *APIs & Services → Credentials → Create Credentials →
   OAuth client ID*. Application type: **Web application**.
5. Under **Authorized JavaScript origins**, add **both**:
   - `http://localhost:5173` (Vite dev server)
   - `https://bevanr.github.io` (GitHub Pages)

   No redirect URI is needed — the GIS token client uses a popup, not a redirect.
6. Copy the generated **Client ID** (ends `.apps.googleusercontent.com`):
   - Into `.env` as `VITE_GOOGLE_CLIENT_ID` for local dev.
   - Into the repo for CI (see below).

Only the `https://www.googleapis.com/auth/tasks` scope is requested.

## Deployment (GitHub Pages)

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs
`npm ci && npm run build` and publishes `dist/` to GitHub Pages. The workflow can
also be run manually via **Actions → Deploy to GitHub Pages → Run workflow**.

The build needs `VITE_GOOGLE_CLIENT_ID`. Because an OAuth **Web** client ID is a
public identifier (it ships in the bundle), store it as a repository **variable**
rather than a secret:

*Settings → Secrets and variables → Actions → Variables → New repository
variable*, name `VITE_GOOGLE_CLIENT_ID`.

The workflow passes it to the build as
`VITE_GOOGLE_CLIENT_ID: ${{ vars.VITE_GOOGLE_CLIENT_ID }}`.

Also ensure Pages is enabled with **Source: GitHub Actions**
(*Settings → Pages*). The site is served under `/g-tasks/`, which is why Vite's
`base` is set to `/g-tasks/`.
