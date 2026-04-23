# @anby/manifest-schema

## 1.1.0

### Minor Changes

- 2a63dda: platform-sdk: MultiIssuerVerifier + signServiceToken for service apps

  Lets internal service apps (god-brain, future Mission Map, AI Employee) authenticate calls into apps with their own Ed25519 identity instead of leaking INTERNAL_API_SECRET into third-party app code.

  New exports from `@anby/platform-sdk`:

  - `MultiIssuerVerifier(registryUrl, acceptIssuers[])` — verifies tokens from any issuer in the allowlist. Resolves keys per `iss`: `'anby-registry'` from `/registry/entity-token/public-key` (existing), service-app issuers from `/registry/services/{appId}/public-key` (new endpoint, ships in anby-platform).
  - `createAppVerifier({ acceptIssuers? })` — factory using bootstrap-discovered registry URL. No SharedSecretVerifier fallback. Default `acceptIssuers = ['anby-registry']`.
  - `signServiceToken({ scope, tenantId, ttlSeconds })` — Ed25519 JWT signing with the calling service-app's bootstrapped identity. `iss = sub = appId`.

  Other changes:

  - `bootstrapFromToken()` warns if `INTERNAL_API_SECRET` is set in app env (apps no longer need it; safe to remove).
  - `ScopedTokenClaims.iss` widened from literal `'anby-registry'` to `string` so multi-issuer claim shapes type-check.
  - `RegistryPublicKeyVerifier` behavior unchanged externally; internally refactored to share the multi-issuer verify path.
  - `SharedSecretVerifier` marked `@deprecated` — kept exported for back-compat; will be removed in v2.0.

  Backwards compatible: existing consumers of `RegistryPublicKeyVerifier` and `SharedSecretVerifier` continue to work without changes.

## 1.0.0

### Major Changes

- 1c82c24: Add frontend.pages[] with stable id + resolveManifestPages()
