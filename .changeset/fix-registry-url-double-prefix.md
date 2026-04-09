---
"@anby/platform-sdk": patch
---

fix(platform-sdk): strip `/registry` suffix from discovered `registryUrl` before storing in platform config

The discovery endpoint returns `registryUrl` with `/registry` already appended (by contract — see `discovery.controller.ts`), but the in-process consumers of `getPlatformConfig().registryUrl` (`entities/resolver.ts`, `entities/token.ts`, `entities/handler.ts`) all build their own `/registry/...` paths on top, producing `/registry/registry/entity-map` → 404 against the registry.

Bootstrap now normalizes `registryUrl` to the host root using the same regex `getDiscoveredRegistryBaseUrl()` already uses for the publish path. The wire contract is unchanged; only the in-memory shape is normalized.

Symptom: `registry entity-map fetch failed (404) for tenant default` when any third-party service tried to call `getEntityClient()` against the registry.
