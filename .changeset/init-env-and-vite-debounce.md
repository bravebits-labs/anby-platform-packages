---
"@anby/cli": minor
"@anby/platform-sdk": patch
---

- cli: `anby init` now writes `ANBY_APP_TOKEN` and `APP_PUBLIC_URL` to `.env` instead of `.env.local`, and upserts the values (replacing existing keys) rather than appending duplicates. Skips registration only when `.env` already has a non-empty `ANBY_APP_TOKEN`.
- cli: `anby init` scaffolds `[_anby].manifest[.json].tsx` route so Remix serves `manifest.json` (Remix intercepts `/_anby/*` before Vite's public/ middleware).
- cli: `anby init` scaffolds `[_anby].set-token.tsx` route for setting auth-token cookie server-side (browsers block `document.cookie` in cross-origin iframes).
- cli: `anby init` patches `entry.server.tsx` to extract `?_anby_token=` from the URL, set a first-party HttpOnly cookie, and redirect to strip the token from the URL.
- platform-sdk: debounce the Vite watcher's source re-scan by 2s so bulk file changes during HMR trigger a single manifest regeneration instead of one per file.
