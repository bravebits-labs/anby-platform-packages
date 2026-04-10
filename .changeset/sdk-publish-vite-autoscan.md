---
"@anby/platform-sdk": minor
---

feat(platform-sdk): Ed25519 app identity signing for publish + Vite auto-scan for entities/events

- `publishAppFromManifest` now prefers Ed25519 app identity signing over HMAC, falling back to HMAC for first-time publish
- Vite plugin gains auto-scan: discovers entity/event usage from source code (`getEntityClient`, `publishEvent`, schema files) and keeps `anby-app.manifest.json` in sync automatically
- Vite plugin now watches source directories for changes and re-scans on `.ts/.tsx/.js/.jsx` file changes
