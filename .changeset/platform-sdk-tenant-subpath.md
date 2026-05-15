---
'@anby/platform-sdk': patch
'@anby/contracts': patch
'@anby/manifest-schema': patch
'@anby/cli': patch
---

Add ./tenant subpath for browser-safe placeholder helpers.

isPlaceholderTenant + INVALID_TENANT_PLACEHOLDERS moved from src/auth/index.ts
to a new src/tenant/index.ts module with zero Node dependencies. The auth and
root entries re-export them for backward compatibility.

Browser apps should now import from '@anby/platform-sdk/tenant' instead of
'@anby/platform-sdk/auth' to avoid Vite pre-bundling jsonwebtoken/jws and
hitting "util.inherits is not a function" at runtime.

Linked-group siblings bump together; no functional change in them.
