# App icons

Placeholder directory. The following PWA icons must be added here before a
production deploy (referenced by the web manifest in `vite.config.ts`):

| File                  | Size    | Purpose            |
| --------------------- | ------- | ------------------ |
| `icon-192.png`        | 192×192 | `any`              |
| `icon-512.png`        | 512×512 | `any`              |
| `icon-maskable.png`   | 512×512 | `maskable`         |

Notes:
- The maskable icon needs adequate safe-zone padding (~20% on each edge) so it
  renders correctly inside adaptive-icon masks.
- Files in `public/` are copied to the site root at build time. Vite `base` is
  relative (`'./'`), so they resolve under whatever path the app is served from
  (e.g. `https://bevanr.github.io/Swipe-GT/icons/…`) — the build is path-portable
  and not pinned to any fixed base.
