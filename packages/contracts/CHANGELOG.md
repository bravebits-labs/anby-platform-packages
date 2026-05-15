# @anby/contracts

## 1.4.1

### Patch Changes

- 0506038: Add ./tenant subpath for browser-safe placeholder helpers.

  isPlaceholderTenant + INVALID_TENANT_PLACEHOLDERS moved from src/auth/index.ts
  to a new src/tenant/index.ts module with zero Node dependencies. The auth and
  root entries re-export them for backward compatibility.

  Browser apps should now import from '@anby/platform-sdk/tenant' instead of
  '@anby/platform-sdk/auth' to avoid Vite pre-bundling jsonwebtoken/jws and
  hitting "util.inherits is not a function" at runtime.

  Linked-group siblings bump together; no functional change in them.

## 1.4.0

### Minor Changes

- 00b2263: Add isPlaceholderTenant helper + ./auth subpath export.

  New auth helpers — isPlaceholderTenant(tenantId) returns true for known
  non-real tenant sentinels ('default', '**legacy**', 'dev-tenant'). The set
  is also exported as INVALID_TENANT_PLACEHOLDERS. Backend write paths and
  frontend auth bootstraps can use this to reject placeholder tenants and
  route users to the create-org flow before they hit a 400 from
  require-valid-tenant middleware.

  New ./auth subpath export — browser apps can now do
  import { ... } from '@anby/platform-sdk/auth' instead of importing from
  the root entry. The root entry re-exports PostgresEventTransport, which
  uses await import('pg') for its Node-only DB driver. When a browser
  bundler pre-bundles the root entry, it traverses the events module and
  tries to resolve pg for the browser graph — which fails.

  The new subpath lets browser code import auth helpers without dragging in
  the events module at all. Strictly additive: the root entry is unchanged,
  so every existing consumer continues to work.

  Linked-group packages (@anby/contracts, @anby/manifest-schema, @anby/cli)
  bump together per .changeset/config.json but contain no functional
  changes in this release.

## 1.3.0

### Minor Changes

- Linked version bump only — kept in lockstep with `@anby/manifest-schema` 1.3.0 (per-locale page descriptions).

## 1.2.0

### Minor Changes

- Linked version bump only — kept in lockstep with `@anby/manifest-schema` 1.2.0 (per-locale page labels).

## 1.1.0

### Minor Changes

- Linked version bump only; no source changes (rode along with platform-sdk multi-issuer/signServiceToken).

## 1.0.0

### Major Changes

- 1c82c24: Add frontend.pages[] with stable id + resolveManifestPages()
