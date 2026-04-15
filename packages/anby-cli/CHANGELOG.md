# @anby/cli

## 0.9.0

### Minor Changes

- ec970c5: - cli: `anby init` now writes `ANBY_APP_TOKEN` and `APP_PUBLIC_URL` to `.env` instead of `.env.local`, and upserts the values (replacing existing keys) rather than appending duplicates. Skips registration only when `.env` already has a non-empty `ANBY_APP_TOKEN`.
  - cli: `anby init` scaffolds `[_anby].manifest[.json].tsx` route so Remix serves `manifest.json` (Remix intercepts `/_anby/*` before Vite's public/ middleware).
  - cli: `anby init` scaffolds `[_anby].set-token.tsx` route for setting auth-token cookie server-side (browsers block `document.cookie` in cross-origin iframes).
  - cli: `anby init` patches `entry.server.tsx` to extract `?_anby_token=` from the URL, set a first-party HttpOnly cookie, and redirect to strip the token from the URL.
  - cli: default registry URL changed from `registry.anby.ai` to `apps.anby.ai`.
  - cli: `anby init` now validates existing `ANBY_APP_TOKEN` against the target registry — re-registers when the token's `platformUrl` doesn't match, instead of blindly skipping.
  - platform-sdk: debounce the Vite watcher's source re-scan by 2s so bulk file changes during HMR trigger a single manifest regeneration instead of one per file.
  - platform-sdk: fix Ed25519 JWT verification in `RegistryPublicKeyVerifier` / `SharedSecretVerifier`. The `jsonwebtoken`/`jws` dependency can't parse Ed25519 keys (`"Unknown key type 'ed25519'"`), causing all EdDSA registry tokens to fail verification. Replaced with a native `node:crypto` JWT verifier that handles EdDSA, RS256, and HS256 directly, enforces the configured algorithm (prevents algo-confusion), and validates `iss`/`exp`/`nbf`.

### Patch Changes

- Updated dependencies [ec970c5]
  - @anby/platform-sdk@0.9.0

## 0.8.0

### Minor Changes

- 70e6774: feat(cli): add `anby login` / `anby logout` commands and interactive `anby init` with auto-registration

  - Added Google OAuth login flow via `anby login` (opens browser, receives token via local callback server)
  - Added `anby logout` to clear stored credentials from `~/.anby/auth.json`
  - Refactored `anby init` to be fully interactive: prompts for app name and port, auto-generates reverse-domain app ID from logged-in user's email
  - Init now scaffolds `app/lib/auth.server.ts` and patches `app/entry.server.tsx` with SDK bootstrap
  - Init auto-registers the app with the registry and writes `ANBY_APP_TOKEN` to `.env.local`

### Patch Changes

- Updated dependencies [70e6774]
  - @anby/platform-sdk@0.8.0

## 0.7.0

### Minor Changes

- ca61313: Zero-config Marketplace submit flow.

  **`@anby/platform-sdk`**

  - New public helper `getInlinedManifest({ manifestPath? })` — loads
    `anby-app.manifest.json` and resolves all `provides.entities[].schema`
    paths into inlined JSON content. Same code path that
    `publishAppFromManifest()` already uses internally.
  - `anbyVitePlugin()` now writes `public/_anby/manifest.json` at
    `buildStart` (and on every manifest file change). Vite/Remix serve
    `public/` as static assets in both dev and production, so a single
    artifact powers the Marketplace Submit-app form everywhere — no
    middleware, no Remix route file, no custom server.

  **`@anby/cli`**

  - `anby init` now bootstraps the entire project, not just the
    manifest skeleton:
    1. Writes `anby-app.manifest.json` (existing behaviour)
    2. Idempotently patches `vite.config.{ts,mts,js,mjs}` to import and
       register `anbyVitePlugin()` — skips when already wired, prints a
       clear instruction when no Vite config exists
    3. Idempotently appends `public/_anby/` to `.gitignore` so the
       auto-generated wire manifest stays out of commits

  After running `npx anby init` once, a publisher's app is ready to be
  submitted from the Marketplace UI by URL alone — the operator never
  pastes any JSON and the publisher never edits any code.

### Patch Changes

- Updated dependencies [ca61313]
  - @anby/platform-sdk@0.7.0
