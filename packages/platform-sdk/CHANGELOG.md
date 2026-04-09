# @anby/platform-sdk

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
