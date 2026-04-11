# @anby/platform-sdk

## 0.8.1

### Patch Changes

- ec970c5: - cli: `anby init` now writes `ANBY_APP_TOKEN` and `APP_PUBLIC_URL` to `.env` instead of `.env.local`, and upserts the values (replacing existing keys) rather than appending duplicates. Skips registration only when `.env` already has a non-empty `ANBY_APP_TOKEN`.
  - platform-sdk: debounce the Vite watcher's source re-scan by 2s so bulk file changes during HMR trigger a single manifest regeneration instead of one per file.

## 0.8.0

### Minor Changes

- 70e6774: feat(platform-sdk): Ed25519 app identity signing for publish + Vite auto-scan for entities/events

  - `publishAppFromManifest` now prefers Ed25519 app identity signing over HMAC, falling back to HMAC for first-time publish
  - Vite plugin gains auto-scan: discovers entity/event usage from source code (`getEntityClient`, `publishEvent`, schema files) and keeps `anby-app.manifest.json` in sync automatically
  - Vite plugin now watches source directories for changes and re-scans on `.ts/.tsx/.js/.jsx` file changes

## 0.7.2

### Patch Changes

- 1a1ae4a: fix(platform-sdk): stop hiding ScopedTokenError under EntityProviderUnreachableError + clarify 304-with-no-cache resolver edge case

  Two debugging-papercut fixes that hid the real cause of failures behind misleading wrappers:

  **1. `entities/client.ts` — auth failures were misreported as network failures.**
  The `try/catch` around `doRequest()` wrapped _every_ error from the underlying call (including `ScopedTokenError` from `getScopedToken()`) as `EntityProviderUnreachableError`. That sent operators chasing phantom IPv6/firewall/DNS issues for hours when the real cause was a registry 401 ("signature mismatch", "app not installed", revoked, etc.). `ScopedTokenError` now propagates with its original message and HTTP status.

  **2. `entities/resolver.ts` — 304 Not Modified with an empty in-memory cache fell through to the generic error branch.**
  If the registry replied 304 to a cold caller (cache cleared mid-flight, stale ETag in a race), the function fell through `if (cur) return ...` into `if (!res.ok)` and threw `"registry entity-map fetch failed (304)"` — wrong root cause and wrong status semantics. Now it throws an explicit message naming the contract violation.

## 0.7.1

### Patch Changes

- a19f956: fix(platform-sdk): strip `/registry` suffix from discovered `registryUrl` before storing in platform config

  The discovery endpoint returns `registryUrl` with `/registry` already appended (by contract — see `discovery.controller.ts`), but the in-process consumers of `getPlatformConfig().registryUrl` (`entities/resolver.ts`, `entities/token.ts`, `entities/handler.ts`) all build their own `/registry/...` paths on top, producing `/registry/registry/entity-map` → 404 against the registry.

  Bootstrap now normalizes `registryUrl` to the host root using the same regex `getDiscoveredRegistryBaseUrl()` already uses for the publish path. The wire contract is unchanged; only the in-memory shape is normalized.

  Symptom: `registry entity-map fetch failed (404) for tenant default` when any third-party service tried to call `getEntityClient()` against the registry.

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
