# @anby/manifest-schema

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

- Per-locale page descriptions via `description_<locale>`.

  Mirrors the `label_<locale>` pattern shipped in 1.2.0. Apps can declare locale-specific page descriptions alongside the default `description`:

  ```json
  {
    "id": "okr-map",
    "label": "OKR Map",
    "label_vi": "Bản đồ OKR",
    "description": "Org-wide OKR map — objectives & key results",
    "description_en": "Org-wide OKR map — objectives & key results",
    "description_vi": "Bản đồ OKR toàn tổ chức — objectives & key results"
  }
  ```

  Schema additions:

  - `frontend.pages[].patternProperties` extended with `^description_[a-z]{2}$` (max 300 chars per locale).
  - `ResolvedPage` interface gains `descriptions: Record<string, string>` populated from `description_xx` fields on both `pages[]` and legacy `routes[]`.
  - `resolveManifestPages()` extracts the per-locale descriptions into the new map.

  Backwards compatible: apps without `description_xx` keep working — `descriptions` is just an empty object. Consumers should pick `descriptions[currentLocale] ?? description`.

## 1.2.0

### Minor Changes

- Per-locale page labels via `label_<locale>`.

  Apps can declare locale-specific sidebar labels alongside the default `label`:

  ```json
  {
    "id": "okr-map",
    "path": "/okrs",
    "label": "OKR Map",
    "label_en": "OKR Map",
    "label_vi": "Bản đồ OKR"
  }
  ```

  Schema additions:

  - `frontend.pages[].patternProperties: { "^label_[a-z]{2}$": { "type": "string" } }` — accepts any 2-letter ISO locale code as a `label_xx` field.
  - `AppManifest.frontend.pages[]` TypeScript interface widened with an index signature `[key: \`label\_${string}\`]?: string`.
  - `ResolvedPage` interface gains `labels: Record<string, string>` populated from `label_xx` fields on both `pages[]` and legacy `routes[]`.
  - `resolveManifestPages()` extracts the locale labels into the new `labels` map.

  Backwards compatible: apps that don't declare `label_xx` keep working — `labels` is just an empty object. Consumers should pick `labels[currentLocale] ?? label`.

## 1.1.0

### Minor Changes

- Linked version bump only; no source changes (manifest-schema rode along with the platform-sdk multi-issuer/signServiceToken release).

## 1.0.0

### Major Changes

- 1c82c24: Add frontend.pages[] with stable id + resolveManifestPages()
