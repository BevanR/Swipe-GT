# Backend / provider alternatives for recurrence + due times

**Status:** research only, no code changes. Written 2026-09-14.
**Audience:** the owner deciding whether (and how) to move Swipe GT off the Google Tasks API.

## Why this exists

Swipe GT is a static PWA on GitHub Pages with **no backend**. It talks straight to the
Google Tasks REST API from the browser using a Google Identity Services (GIS) token
(see `docs/STATUS.md`). Two hard limits of the *public* Google Tasks API are blocking
features the owner wants:

- **No recurrence field.** The API exposes nothing about repeating tasks; we only find out
  a task recurs when Google *rejects* a cross-list move (`src/api/tasksApi.ts` `move()`).
- **Due date is date-only.** Any time-of-day is normalized to midnight
  (`insert`/`updateTask`/`patchDue` all send `${due}T00:00:00.000Z`).

The owner specifically named **Remember The Milk (RTM)** and wants to know what a switch
to a provider that supports **recurring tasks** and **due times** would take — including
whether it can stay backendless.

### What we would be replacing

The data layer is small and provider-shaped, which makes an adapter swap realistic:

- **`src/api/tasksApi.ts`** — `listTaskLists`, `listTasks`, `insert`, `updateTask`,
  `deleteTask`, `patchDue`, `clearDue`, `move`, `complete`. Each request is just
  `fetch()` + a bearer token from a `TokenGetter`.
- **`src/types.ts`** — `Task { id, taskListId, taskListTitle, title, due (date-only string|null),
  status, position, notes? }`.
- **`src/auth/authClient.ts`** — GIS token client, **no client secret, no refresh token**,
  silent renew, ~weekly interactive re-auth.

Any new provider needs, at minimum, to preserve these methods and be reachable from the
browser (or through a proxy we add). The `Task` model would also need two new optional
fields for the new capabilities: a due **datetime** (or a `dueTime`/`hasTime` flag alongside
the existing date) and a **recurrence** descriptor (RRULE string or the provider's rule shape).

---

## The one question that decides everything: can the browser call it directly?

A static site can only call an API directly when **both** of these hold:

1. **Auth needs no server-held secret.** Either an implicit/token flow (like GIS today) or
   an OAuth2 **authorization-code + PKCE** flow for a *public* client (no `client_secret`).
   If the token *exchange* requires a `client_secret`, that step must happen on a server.
2. **The API's data endpoints send CORS headers** (`Access-Control-Allow-Origin`) for a
   browser origin. Without this, `fetch()` from `bevanr.github.io` is blocked by the browser
   regardless of the token.

If either fails, we need a **small proxy/backend** — even if it does nothing but hold a
secret and re-emit CORS. That is the crux for RTM, Todoist, and TickTick below.

---

## Remember The Milk (RTM) — the owner's pick

Sources: [RTM API overview](https://www.rememberthemilk.com/services/api/overview.rtm) ·
[Authentication](https://www.rememberthemilk.com/services/api/authentication.rtm) ·
[rtm.tasks.setDueDate](https://www.rememberthemilk.com/services/api/methods/rtm.tasks.setDueDate.rtm) ·
[Methods list](https://www.rememberthemilk.com/services/api/methods.rtm) ·
[Timelines](https://www.rememberthemilk.com/services/api/timelines.rtm) ·
[Rate limits](https://www.rememberthemilk.com/services/api/ratelimit.rtm) ·
[`dwaring87/rtm-api` (Node client)](https://github.com/dwaring87/rtm-api)

- **Recurrence — YES.** `rtm.tasks.setRecurrence` sets a repeat rule on the *task series*
  (RTM models a repeating task as a series). Rules are given in RTM's natural-language repeat
  syntax ("every day", "every 2 weeks", "after 3 days"); RTM stores/returns an `rrule`
  element on the task series, so recurrence is both writable and readable.
- **Due time-of-day — YES.** `rtm.tasks.setDueDate` takes `has_due_time=1` to mark a due
  *time* (not just a date), and `parse=1` to accept natural-language dates/times
  (via `rtm.time.parse`). Tasks carry a `has_due_time` flag.
- **Auth model — API key + shared secret + signed calls; user `auth_token`.** Every request
  must carry the `api_key` and an **`api_sig`** = MD5 of the shared secret concatenated with
  all sorted request parameters. A per-user `auth_token` is obtained through a desktop/web
  auth flow (`frob` -> user authorizes -> `rtm.auth.getToken`). Write actions additionally
  require a **timeline** (`rtm.timelines.create`) so RTM can support undo.
  - **Browser-only? NO.** The `api_sig` signature requires the **shared secret**, which is a
    long-lived application credential. Shipping it in a static bundle exposes it to anyone —
    it is exactly the kind of secret that must stay server-side (the reference Node client
    `dwaring87/rtm-api` is a server library and takes both key and secret at construction).
    RTM also does not advertise CORS on its REST endpoint. **RTM requires a proxy.**
- **Notifications/reminders — YES, RTM's own.** RTM delivers reminders itself (email, SMS,
  mobile push, IM) on a schedule the user configures. Reminder delivery channels are largely
  a **Pro** feature and are configured in RTM, not finely controlled per-call from the API.
- **Cost / limits / account.** API access is free (apply for a key; RTM historically grants
  keys for personal/non-commercial use). Reminders and some power features need **RTM Pro**
  (~US$49.99/year — [Capterra pricing](https://www.capterra.com/p/162672/Remember-The-Milk/)).
  Rate limit: **1 request/sec per client (api_key+IP), burst up to 3/sec** — low, so batch
  and cache.
- **Migration effort — HIGH; needs a backend.** Feature-wise RTM is a great fit (recurrence,
  due time, and built-in reminders all present). But the signing + no-CORS + timeline model
  means we must add a **proxy** that: (a) holds the `api_key` and `shared_secret`, (b) signs
  every call, (c) creates/reuses a timeline for writes, (d) relays JSON with CORS headers to
  `bevanr.github.io`, and (e) ideally brokers the `auth_token` handshake. The browser would
  hold only the RTM `auth_token` (or a session the proxy issues). This ends the "static,
  no-backend" property from `docs/STATUS.md`.

---

## Todoist

Sources: [Todoist API v1 (unified)](https://developer.todoist.com/api/v1/) ·
[v1 launch / Sync+REST merge](https://groups.google.com/a/doist.com/g/todoist-api/c/LKz0K5TRQ9Q/m/IlIemN4-CAAJ) ·
[REST v2 deprecation (410)](https://github.com/BasedHardware/omi/issues/13158) ·
[browser CORS error report](https://github.com/Cosmitar/todoist-js/issues/6) ·
[TypeScript SDK](https://github.com/Doist/todoist-sdk-typescript)

- **Recurrence — YES (natural language).** A task's `due.string` accepts natural-language
  recurrence ("every day", "every 3 weeks", "every monday"); the response marks it with
  `due.is_recurring = true` and echoes the `due.string`. Todoist does **not** take a raw
  RRULE as input — you drive recurrence through the natural-language string.
- **Due time-of-day — YES.** `due.datetime` (RFC3339) carries a time; `due.date` is the
  date-only form. (There is also a separate `deadline` concept.)
- **Auth model — OAuth2; browser-capable in part.** Todoist supports the **authorization-code
  flow, and public SPA clients can use PKCE** to avoid shipping a secret. **However:**
  - The token **exchange** endpoint has historically required the **`client_secret`**, which
    forces that one step onto a server (confirm against current v1 docs before committing).
  - The **data API does not officially support CORS** — direct browser `fetch()` to
    `api.todoist.com` is commonly blocked (see the CORS issue above). One recent third-party
    note claimed CORS now passes, but Todoist has not documented CORS support, so treat the
    data plane as **not browser-callable** without a proxy.
  - Net: **Todoist effectively needs a small proxy** (for the token exchange and/or to add
    CORS on data calls), even though its OAuth is otherwise SPA-friendly.
- **Notifications/reminders — YES, but Pro.** Time-based, location, and automatic reminders
  exist and are delivered by Todoist (push/email), but **reminders require Todoist Pro**.
- **Cost / limits / account.** Free tier usable; **reminders need Pro (~US$4/mo)**. Rate
  limits are per-user (REST v2 was ~450 requests/15 min per user; the v1 unified API
  documents its own limits). Free Todoist account required.
- **Migration effort — MEDIUM; likely needs a proxy.** The `Task` model maps cleanly
  (`due.datetime` -> due-with-time; `due.string`/`due.is_recurring` -> recurrence). The
  blocker is transport: budget for a proxy handling the OAuth token exchange and CORS.

---

## Microsoft To Do (Microsoft Graph API)

Sources: [todoTask resource (v1.0)](https://learn.microsoft.com/en-us/graph/api/resources/todotask?view=graph-rest-1.0) ·
[Update todoTask](https://learn.microsoft.com/en-us/graph/api/todotask-update?view=graph-rest-1.0) ·
[Create recurrence To-Do task](https://www.c-sharpcorner.com/article/create-recurrence-to-do-task-using-microsoft-graph-api/) ·
[MSAL.js SPA auth-code + PKCE quickstart](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-v2-javascript-auth-code) ·
[SPA redirect URIs enable CORS](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/migrate-spa-implicit-to-auth-code)

- **Recurrence — YES (calendar-style).** `todoTask.recurrence` is a `patternedRecurrence`
  = `pattern` (`daily`/`weekly`/`absoluteMonthly`/`relativeMonthly`/`absoluteYearly`/
  `relativeYearly`, with interval, daysOfWeek, etc.) + `range` (start, end/numbered/no-end).
  Readable and writable. This is richer/more structured than Google Tasks but not raw RRULE.
- **Due time-of-day — YES.** `dueDateTime` is a **`dateTimeTimeZone`** object
  (`{ dateTime, timeZone }`), so it carries a real time. `reminderDateTime` (also
  `dateTimeTimeZone`) plus `isReminderOn` drives a reminder. (Common gotcha: you must send
  the `{dateTime, timeZone}` object, not a bare ISO string.)
- **Auth model — OAuth2 via MSAL.js; BROWSER-ONLY CAPABLE.** MSAL.js runs the
  **authorization-code flow with PKCE** as a **public client (no client secret)**, and Graph
  endpoints are **CORS-enabled** for redirect URIs registered under the app's *Single-page
  application* platform. Personal Microsoft accounts (as well as work/school) are supported.
  Scope: `Tasks.ReadWrite`. This is the closest analog to today's GIS model — **no backend
  required.** App registration in Entra/Azure is free.
- **Notifications/reminders — YES, provider-fired.** Set `reminderDateTime` + `isReminderOn`
  and the Microsoft To Do apps raise the reminder (toast/push) on the user's devices. No
  server of ours needed.
- **Cost / limits / account.** Free with any Microsoft account; Graph is free with generous
  throttling (per-app/per-user throttling limits apply). Requires a (free) Azure app
  registration.
- **Migration effort — MEDIUM; stays backendless.** Swap GIS for MSAL.js in
  `authClient.ts` (still a token getter, still silent-renew-capable, and PKCE gives a
  refresh token so re-auth is *less* frequent than today). `tasksApi.ts` becomes a Graph
  adapter (`/me/todo/lists`, `/me/todo/lists/{id}/tasks`). `Task` gains a due-with-time and a
  recurrence field. The main cost is behavioral mapping (Graph's `dateTimeTimeZone`,
  `patternedRecurrence`, and list model) — but it **preserves the static, no-backend
  architecture**, which is the big win.

---

## TickTick

Sources: [TickTick Developer / Open API](https://developer.ticktick.com/) ·
[TickTick OAuth2 & API reference (mirror)](https://github.com/FranzFelberer/ticktick-mcp/blob/main/ticktick-api-reference.md) ·
[Essentials guide](https://rollout.com/integration-guides/tick-tick/api-essentials) ·
[unofficial `ticktick-py`](https://github.com/lazeroffmichael/ticktick-py)

- **Recurrence — YES (RRULE).** Tasks carry `repeatFlag` as an RRULE string
  (e.g. `RRULE:FREQ=DAILY;INTERVAL=1`). Read + create.
- **Due time-of-day — YES.** `dueDate`/`startDate` use `yyyy-MM-dd'T'HH:mm:ssZ` with a
  `timeZone` and `isAllDay` flag; `reminders` is a list of trigger durations
  (e.g. `TRIGGER:P0DT9H0M0S`).
- **Auth model — OAuth2 with `client_secret`; NEEDS A BACKEND.** The Open API uses the
  authorization-code grant, and the **token exchange requires the `client_secret`** (a
  confidential client), so it cannot be completed safely in the browser. The data endpoints
  are not documented as CORS-enabled. **TickTick requires a proxy.** Developer access is also
  gated behind registering an app in the Developer Center (client ID/secret), and the public
  Open API surface is comparatively limited.
- **Notifications/reminders — YES, provider-fired.** `reminders` triggers cause the TickTick
  apps to raise reminders on the user's devices.
- **Cost / limits / account.** API is free; some features need **TickTick Premium
  (~US$35.99/yr)**. Rate limit: **100 requests/min per user, burst ~10/sec** (with
  `X-RateLimit-*` headers). Requires a TickTick account + registered developer app.
- **Migration effort — MEDIUM/HIGH; needs a backend.** Model maps well (RRULE + datetime +
  reminders), but the confidential-client OAuth and lack of CORS mean a proxy is mandatory,
  same as RTM/Todoist.

---

## Others (brief)

### Google Calendar API — "tasks as timed, recurring events"
Sources: [Recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents) ·
[Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars) ·
[Reminders & notifications](https://developers.google.com/workspace/calendar/concepts/reminders) ·
[Usage limits](https://developers.google.com/workspace/calendar/api/guides/quota)

- **Recurrence — YES (RRULE).** `event.recurrence` is an array of RFC 5545 `RRULE`/`RDATE`/
  `EXDATE` strings. Full recurrence, read + write.
- **Due time — YES.** `event.start`/`end` use `dateTime` + `timeZone` (real times), or `date`
  for all-day. **Reminders — YES**, per-event `reminders.overrides` (popup/email, N minutes
  before), fired by Google.
- **Auth — SAME as today.** The Calendar API is reachable with the **exact GIS token flow**
  Swipe GT already uses (browser, CORS-enabled, no secret) — just a different scope
  (`https://www.googleapis.com/auth/calendar` or `calendar.events`). Free.
- **Trade-off:** calendar *events* are not *tasks* — there is no `needsAction`/`completed`
  status or checkbox semantics, and no natural "no date" bucket. We'd have to model
  completion ourselves (e.g. an `extendedProperties.private.done` flag, or delete-on-complete)
  and decide how dateless "Someday" items live in a calendar. Conceptually heavier than it
  looks, **but it is the only option that keeps our current auth and stays 100% backendless
  while adding recurrence + times + reminders.**

### CalDAV / VTODO providers (Fastmail, Nextcloud, iCloud, generic)
- **Recurrence + due time + reminders — YES.** VTODO (RFC 5545) supports `RRULE`, `DUE` with
  a time, and `VALARM` reminders. It is the open-standard superset of everything above.
- **Auth/transport — NEEDS A BACKEND.** CalDAV uses WebDAV verbs (`PROPFIND`/`REPORT`/`PUT`)
  with Basic/Bearer auth, and CalDAV servers almost never send CORS headers, so the browser
  cannot talk to them directly. A proxy (and often app-specific passwords) is required.
  Provider-dependent and the most plumbing of any option.

---

## Recommendation

Given the owner's priorities — **recurrence + due times**, currently **backendless static
hosting**, and **uncertain willingness to add a backend** — the decision splits on that last
point.

**If staying backendless is a hard requirement (recommended default):**

1. **Microsoft To Do via Microsoft Graph** — best overall. Native structured recurrence,
   real due *times* (`dueDateTime`), and provider-fired reminders (`reminderDateTime`), all
   reachable **from the browser** via MSAL.js (auth-code + PKCE, CORS-enabled, personal
   accounts, free). It replaces GIS with an equivalent token getter and even improves auth
   (PKCE refresh token -> less frequent re-auth). Cost: leaving the Google ecosystem — tasks
   would live in Microsoft To Do.
2. **Google Calendar API** — if the owner wants to stay in Google and keep the *exact* GIS
   auth. Backendless, RRULE recurrence, timed events, reminders. Cost: events aren't tasks,
   so completion/"Someday" semantics need custom modeling.

**If the owner will run a tiny proxy, RTM (their pick) becomes viable:**

- **Remember The Milk** genuinely has everything requested (recurrence, due times, its own
  reminders) and is a mature task app. Its blocker is purely transport: the shared-secret
  `api_sig` signing and lack of CORS mean it **cannot** be client-only. A small proxy (e.g. a
  Cloudflare Worker / any serverless function) that holds the `api_key` + `shared_secret`,
  signs each call, manages the write **timeline**, and re-emits CORS makes RTM fully usable.
  The same proxy pattern also unlocks **Todoist** and **TickTick**, so this one piece of
  infrastructure is a general "any-provider" enabler.

**Bottom line:** if the owner wants to keep zero backend, go **Microsoft To Do (Graph)** for
the cleanest task-shaped fit, or **Google Calendar** to stay on Google. If the owner
specifically wants **RTM** (or Todoist/TickTick), accept that a **small proxy is required**
and build it once as a generic signed/OAuth relay.

### Browser-only vs needs-a-backend (the split)

| Provider | Recurrence | Due time | Reminders (provider) | Browser-only? |
|---|---|---|---|---|
| **Microsoft To Do (Graph)** | Yes (patternedRecurrence) | Yes (`dueDateTime`) | Yes | **Yes** — MSAL PKCE + CORS |
| **Google Calendar API** | Yes (RRULE) | Yes (`dateTime`) | Yes | **Yes** — same GIS flow |
| **Remember The Milk** | Yes (series repeat) | Yes (`has_due_time`) | Yes (Pro) | **No** — shared-secret signing, no CORS |
| **Todoist** | Yes (NL string) | Yes (`due.datetime`) | Yes (Pro) | **No** — secret token exchange / no CORS |
| **TickTick** | Yes (RRULE) | Yes (`dueDate`) | Yes | **No** — confidential OAuth, no CORS |
| **CalDAV / VTODO** | Yes (RRULE) | Yes (`DUE`) | Yes (VALARM) | **No** — WebDAV verbs, no CORS |

*(Google Tasks today: no recurrence, date-only, browser-only.)*

---

## Migration sketch (applies to any choice)

The existing data layer is already provider-shaped, so the pattern is the same regardless of
which provider wins:

1. **Extend the model.** Add to `Task` (in `src/types.ts`) an optional due-with-time
   (either widen `due` to a datetime or add `dueTime`/`hasTime`) and an optional
   `recurrence` (an RRULE string is the most portable representation; map to/from each
   provider's shape in its adapter). Keep `due` date-only meaning intact for back-compat
   during transition.
2. **Define a `TaskProvider` interface** mirroring today's `TasksApi` surface
   (`listTaskLists`, `listTasks`, `insert`, `updateTask`, `deleteTask`, `patchDue`,
   `clearDue`, `move`, `complete`) plus any new capability methods (e.g. `setRecurrence`).
   The controller (`src/app/controller.ts`) depends on the interface, not on Google.
3. **Write one adapter per provider** behind that interface:
   - **Browser-only providers (Graph, Calendar):** the adapter calls the provider directly
     with a `TokenGetter`, exactly like `tasksApi.ts` does today. `authClient.ts` swaps GIS
     for MSAL (Graph) or a new scope (Calendar). No other infrastructure.
   - **Proxy-required providers (RTM, Todoist, TickTick, CalDAV):** the adapter's base URL
     points at **our proxy origin**, not the provider. The proxy is the only new backend:
     - holds the app secret(s) — RTM `shared_secret`, or the OAuth `client_secret`;
     - **signs** requests (RTM `api_sig`) or performs the **OAuth token exchange** and stores
       refresh tokens;
     - manages provider quirks (RTM **timeline** creation for writes);
     - forwards the provider's JSON back with **CORS headers** for `bevanr.github.io`.
     A Cloudflare Worker (or any small serverless function) is enough; it is stateless except
     for optional per-user token storage.
4. **Where the proxy sits.** Between the PWA and the provider. The browser authenticates the
   *user* (or the proxy brokers it), the proxy authenticates the *app* and adds CORS. This is
   the single decision that ends the "no backend" property in `docs/STATUS.md` — only the
   proxy-required providers force it; Graph and Calendar do not.
