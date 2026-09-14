# Scheduled / time-based notifications in a PWA

Research for **Swipe GT** — a static, backend-less PWA on GitHub Pages (see
`docs/STATUS.md`). Question from the owner: *can the app ping me at a specific
time (e.g. a task due at 3pm), on Android, when the app isn't open?*

**Short answer:** Yes, this is possible and works well on Android (and on
iOS 16.4+ installed PWAs, and desktop) — but **only via Web Push driven by a
backend that sends the push at the due time**. A static PWA cannot reliably
wake itself at a specific time. The one browser API that promised local,
self-scheduled notifications (Notification Triggers) was **abandoned and never
shipped**. So adding real reminders means adding a small backend — which is the
same conclusion the refresh-token / backend-alternatives investigations reach,
so the three dovetail.

_Researched 2026-09-14; sources cited inline._

---

## TL;DR verdict

| Approach | Fires when app is closed? | Exact time? | Usable in 2026? | Needs backend? |
|---|---|---|---|---|
| **Web Push (Push API + VAPID) + server scheduler** | **Yes** | **Yes** | **Yes** — Android, iOS 16.4+ (installed), desktop | **Yes** |
| Notification Triggers (`showTrigger`/`TimestampTrigger`) | (would have) | (would have) | **No — abandoned, never shipped** | No |
| Periodic Background Sync | Yes-ish | **No** (≥12h, engagement-gated, fuzzy) | Chrome/Android only, niche | No (but useless for exact reminders) |
| `setTimeout` / local `showNotification` | **No** (only while open) | Yes, but only while tab/app is alive | Yes | No |

**Only Web Push + a scheduler does the job.** Everything else either can't wake
a closed app, or can't hit a specific time.

---

## 1. Web Push (Push API + VAPID) + a server scheduler — the standard path

This is the only approach that reliably delivers a notification at a chosen time
while the app is closed. It has three moving parts.

### a) Client: permission, subscription, service-worker `push` handler

1. **Permission (requires a user gesture).** Call
   `Notification.requestPermission()` from inside a user-initiated event (a tap
   on an "Enable reminders" button). Browsers block the prompt unless it's tied
   to a gesture, and once the user picks *Block* you cannot re-prompt from JS on
   that origin — so gate it behind an explicit opt-in, not on page load.
   ([MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API),
   [dev.to field notes](https://dev.to/ahmed_mahmoud360/web-push-in-the-nextjs-app-router-field-notes-on-service-workers-vapid-and-the-ios-rule-that-1oj2))

2. **Subscribe.** Call
   `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID public key> })`.
   This returns a `PushSubscription` (an endpoint URL at the browser vendor's
   push service — FCM for Chrome, Mozilla autopush, Apple's push service — plus
   two crypto keys, `p256dh` and `auth`). `userVisibleOnly: true` is **not
   optional**: you are promising to display a user-visible notification for
   **every** push you receive; browsers can revoke your subscription if you
   receive pushes silently.
   ([MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API),
   [magicbell guide](https://www.magicbell.com/blog/using-push-notifications-in-pwas))

3. **Service-worker `push` handler.** When the push arrives, the browser starts
   your service worker (even if no tab/app is open) and fires the `push` event.
   Your handler shows the notification:

   ```js
   self.addEventListener('push', (event) => {
     const data = event.data?.json() ?? {};
     event.waitUntil(
       self.registration.showNotification(data.title ?? 'Reminder', {
         body: data.body,
         data: { url: data.url, taskId: data.taskId },
         tag: data.taskId,       // coalesce/replace by task
       })
     );
   });

   self.addEventListener('notificationclick', (event) => {
     event.notification.close();
     event.waitUntil(clients.openWindow(event.notification.data.url ?? '/'));
   });
   ```

   The SW is *started as necessary* to handle the incoming message and reacts in
   `onpush` via `ServiceWorkerRegistration.showNotification()`.
   ([MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API))
   Swipe GT already ships a Workbox service worker (`src/pwa/`), so this is an
   additive handler, not a new SW.

### b) VAPID keys

Web Push uses **VAPID** (Voluntary Application Server Identification): an
elliptic-curve (P-256) key pair. The **public** key is handed to the browser at
subscribe time (`applicationServerKey`); the **private** key stays on your
server and signs every push request so the vendor push service can verify the
sender. Generate the pair once (e.g. `web-push generate-vapid-keys`) and store
the private key as a server secret.
([Bocoup full-stack guide](https://www.bocoup.com/blog/full-stack-web-push-api-guide),
[MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API))

### c) **A backend must send the push at the scheduled time**

This is the crux: **a PWA cannot reliably wake itself at a future time.** The
notification only appears when a push message is *delivered* to the browser's
push service, and only your application server can send that message. So you
need a server component that:

1. **Stores** each user's `PushSubscription` (endpoint + keys).
2. **Stores** the schedule — for Swipe GT, a due date/time per task (or a
   digest time). Note Google Tasks stores **date only**, so time-of-day would
   be app-side metadata (see the "Due time-of-day" backlog item in
   `docs/STATUS.md`).
3. **At the due moment**, signs a Web Push request with the VAPID private key
   and POSTs the (encrypted) payload to the subscription endpoint. Use a mature
   library (`web-push` for Node, `pywebpush`, etc.) — it handles the ECDH/AES-GCM
   payload encryption and VAPID signing.
   ([Bocoup guide](https://www.bocoup.com/blog/full-stack-web-push-api-guide),
   [Laravel Web Push](https://laravel-news.com/laravel-web-push-notifications))

### Platform support in 2026

- **Android — Chrome / installed PWA:** fully supported and reliable; the SW is
  woken to handle the push. This is the owner's primary target.
- **iOS / iPadOS 16.4+ (March 2023):** Web Push works, **but only for PWAs the
  user has added to the Home Screen** via Safari → Share → *Add to Home Screen*.
  A plain Safari tab (or any third-party browser tab) has **no** `PushManager`
  access — subscribing throws unless launched as the installed Home-Screen app.
  ~95% of iPhones run iOS 16+ as of early 2026, so reach is broad. Safari 18.4
  later added **Declarative Web Push** (a simplified path that can show a
  notification without running JS in the SW), and iOS 26 defaults Home-Screen
  sites to open as web apps.
  ([MobiLoud iOS PWA guide 2026](https://www.mobiloud.com/blog/progressive-web-apps-ios/),
  [MobiLoud PWA push](https://www.mobiloud.com/blog/pwa-push-notifications),
  [MagicBell iOS limitations 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide),
  [InstantPWA](https://instantpwa.com/answers/can-pwa-send-push-notifications-ios))
- **Desktop (Chrome, Edge, Firefox, Safari):** supported.

### Key constraints to design around

- Permission prompt **must** come from a user gesture; only ask after the user
  opts into reminders.
- On **iOS the app must be installed** to the Home Screen first — surface an
  "Add to Home Screen, then enable reminders" flow.
- `userVisibleOnly: true` — every push must show a notification.
- Subscriptions **expire / rotate**; the server must handle `410 Gone` /
  `404` responses from the push endpoint by deleting the dead subscription, and
  the client should re-subscribe on `pushsubscriptionchange`.
- Delivery timing is *best-effort* (device may be offline/dozing); it's a
  reminder, not a hard real-time guarantee — but on Android it is dependable to
  within a small window.

---

## 2. Notification Triggers API (`TimestampTrigger` / `showTrigger`) — dead

This API was designed to do *exactly* what the owner wants **without a server**:
schedule a local notification at a timestamp, e.g.

```js
registration.showNotification('Task due', {
  showTrigger: new TimestampTrigger(dueTimeMs),  // fires locally at dueTimeMs
});
```

**Status: development discontinued; never shipped to stable Chrome.** The
official Chrome doc now carries a warning at the top:

> "The development of Notification Triggers API, part of Google's capabilities
> project, is no longer pursued."

History: it ran two origin trials only — **Chrome 80–83** and **Chrome 86–88** —
and never advanced past the early spec stage. It remains reachable *only* behind
the `#enable-experimental-web-platform-features` flag for local testing, which
means **it is not usable in production for real users**. Chrome cited an
evolving cross-OS notification landscape, no good way to prune stale scheduled
notifications without keeping the tab open, and developer feedback that Periodic
Background Sync's cadence was insufficient.
([Chrome for Developers — Notification Triggers](https://developer.chrome.com/docs/web-platform/notification-triggers)
[[source markdown]](https://github.com/GoogleChrome/developer.chrome.com//blob/main/site/en/docs/web-platform/notification-triggers/index.md),
[Chrome Platform Status](https://chromestatus.com/feature/5133150283890688),
[explainer/spec repo](https://github.com/beverloo/notification-triggers))

**Do not build on it.** It's the tempting no-backend option, and it's a dead end.

---

## 3. Periodic Background Sync — not suitable for exact-time reminders

The Web Periodic Background Synchronization API lets a service worker run
periodic tasks in the background. In principle you could wake up, check "is
anything due?", and fire a local notification. In practice it can't do
exact-time reminders:

- **Minimum interval ~12 hours.** Chrome enforces at least a 12-hour gap between
  `periodicsync` events; you cannot ask for "in 45 minutes."
- **Timing is not developer-controlled.** The browser decides when (or whether)
  to fire, factoring in network and device state — no precise, predictable
  firing time.
- **Engagement-gated.** In Chrome the event won't fire at all unless the site's
  engagement score is > 0, and engagement affects frequency. A rarely-opened app
  may get no syncs.
- **Installed-app + Chromium only.** Permission is granted only to an installed
  web app launched as a standalone app; the API is Chromium-only (**not** on
  Firefox or Safari/iOS).

([MDN Periodic Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API),
[Chrome for Developers — Periodic Background Sync](https://developer.chrome.com/docs/capabilities/periodic-background-sync),
[spec](https://wicg.github.io/periodic-background-sync/index.html))

Fine for "refresh cached content roughly once a day"; **wrong tool for "ping me
at 3pm."**

---

## 4. Local notifications while the app is open / `setTimeout` — open-only

You can absolutely show a notification (or fire a `setTimeout`) *while the app is
running*:

```js
setTimeout(() => registration.showNotification('Due now', { body: '...' }),
           msUntilDue);
```

**Limitation:** this only works while the tab/PWA is actually open and the
page/SW is alive. As soon as the app is backgrounded or closed, the timer is
frozen or discarded — a `setTimeout` scheduled for 3pm won't fire if the app was
closed at 2pm. Service workers are also terminated aggressively when idle, so
you cannot keep a long-lived timer in the SW either. Useful only for in-session
nudges (e.g. "this is due in 10 minutes" while you're using the app), never for
"remind me later when I've closed it."

---

## The verdict + minimal architecture

**What actually works for "remind me at a specific time even when the app is
closed": Web Push + a backend scheduler. Nothing else.** The abandoned
Notification Triggers API was the only route that would have avoided a server,
and it's gone; Periodic Background Sync can't hit a specific time; `setTimeout`
dies when the app closes.

This means reminders **require leaving the "static, no-backend" constraint**
that Swipe GT holds today (`docs/STATUS.md` → *Locked-in decisions*). That is
the same crossroads as the refresh-token question (a durable Google session
needs a server to hold the refresh token) and the backend-alternatives
investigation — so if a backend gets added for any one of those, it can serve
all three.

### Minimal architecture

```
Client (existing PWA)                    Backend (new, small)
─────────────────────                    ────────────────────
[Enable reminders] tap
  → Notification.requestPermission()
  → pushManager.subscribe(VAPID pub)
  → POST subscription  ───────────────►  store PushSubscription (per user)

set/edit a task's reminder time
  → POST {taskId, fireAt}  ───────────►  store schedule row

                                         Scheduler (cron / queue):
                                           at fireAt →
                                             web-push.sendNotification(
                                               subscription, payload,
                                               {VAPID keys})
                                                 │
      ┌──────────────────────────────────────────┘
      ▼
Vendor push service (FCM/Mozilla/Apple)
      │
      ▼
Service worker 'push' handler  → showNotification()   ← fires even if app closed
```

Three pieces to build:

1. **SW `push` + `notificationclick` handlers** — add to the existing Workbox
   SW in `src/pwa/`. Small.
2. **Push-subscription storage** — a table/row per user holding the endpoint +
   `p256dh`/`auth` keys, plus dead-subscription cleanup on `410`/`404`.
3. **A scheduler service** — stores `{ subscription, fireAt, payload }` and, at
   `fireAt`, signs with the VAPID private key and POSTs the encrypted push.

### Effort / hosting notes

- Use a Web Push library (Node `web-push`, `pywebpush`) — don't hand-roll the
  ECDH/AES-GCM encryption or VAPID signing.
- The scheduler wants **durable, time-triggered execution**: a cron worker, a
  delayed queue, or a scheduled serverless function. Options that fit a hobby
  PWA: a Cloudflare Worker + **Cron Triggers** + KV/D1 for storage, a small
  always-on Node service with a job queue (BullMQ/Agenda), or Supabase/Postgres
  with `pg_cron` + Edge Functions. All are modest (an afternoon to a couple of
  days), and overlap with whatever backend the refresh-token / backend-
  alternatives work lands on.
- Because Google Tasks stores **date only** (no time-of-day), any per-task
  reminder *time* is app/backend metadata, not something round-tripped through
  Google.

---

## Sources

- MDN — [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- MDN — [Web Periodic Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API)
- Chrome for Developers — [Notification Triggers API (development discontinued)](https://developer.chrome.com/docs/web-platform/notification-triggers) ([source md](https://github.com/GoogleChrome/developer.chrome.com//blob/main/site/en/docs/web-platform/notification-triggers/index.md))
- Chrome Platform Status — [Notification Triggers feature](https://chromestatus.com/feature/5133150283890688)
- Notification Triggers [explainer/spec repo (beverloo)](https://github.com/beverloo/notification-triggers)
- Chrome for Developers — [Periodic Background Sync](https://developer.chrome.com/docs/capabilities/periodic-background-sync)
- WICG — [Periodic Background Sync spec](https://wicg.github.io/periodic-background-sync/index.html)
- Bocoup — [Full-Stack Web Push API Guide](https://www.bocoup.com/blog/full-stack-web-push-api-guide)
- MagicBell — [Using Push Notifications in PWAs](https://www.magicbell.com/blog/using-push-notifications-in-pwas) · [PWA iOS Limitations & Safari Support (2026)](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- MobiLoud — [Do PWAs Work on iOS? (2026)](https://www.mobiloud.com/blog/progressive-web-apps-ios/) · [PWA Push Notifications (iOS & Android)](https://www.mobiloud.com/blog/pwa-push-notifications)
- InstantPWA — [Can PWAs send push notifications on iOS? (2026)](https://instantpwa.com/answers/can-pwa-send-push-notifications-ios)
- dev.to — [Web Push in Next.js: Service Workers, VAPID, and the iOS Rule](https://dev.to/ahmed_mahmoud360/web-push-in-the-nextjs-app-router-field-notes-on-service-workers-vapid-and-the-ios-rule-that-1oj2)
- Laravel News — [Laravel Web Push Notifications](https://laravel-news.com/laravel-web-push-notifications)
