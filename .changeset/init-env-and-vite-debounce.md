---
"@anby/cli": patch
"@anby/platform-sdk": patch
---

- cli: `anby init` now writes `ANBY_APP_TOKEN` and `APP_PUBLIC_URL` to `.env` instead of `.env.local`, and upserts the values (replacing existing keys) rather than appending duplicates. Skips registration only when `.env` already has a non-empty `ANBY_APP_TOKEN`.
- platform-sdk: debounce the Vite watcher's source re-scan by 2s so bulk file changes during HMR trigger a single manifest regeneration instead of one per file.
