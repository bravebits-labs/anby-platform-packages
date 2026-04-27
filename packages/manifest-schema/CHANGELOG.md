# @anby/manifest-schema

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
  - `AppManifest.frontend.pages[]` TypeScript interface widened with an index signature `[key: \`label_${string}\`]?: string`.
  - `ResolvedPage` interface gains `labels: Record<string, string>` populated from `label_xx` fields on both `pages[]` and legacy `routes[]`.
  - `resolveManifestPages()` extracts the locale labels into the new `labels` map.

  Backwards compatible: apps that don't declare `label_xx` keep working — `labels` is just an empty object. Consumers should pick `labels[currentLocale] ?? label`.

## 1.1.0

### Minor Changes

- Linked version bump only; no source changes (manifest-schema rode along with the platform-sdk multi-issuer/signServiceToken release).

## 1.0.0

### Major Changes

- 1c82c24: Add frontend.pages[] with stable id + resolveManifestPages()
