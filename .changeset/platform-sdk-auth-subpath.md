---
'@anby/platform-sdk': minor
'@anby/contracts': minor
'@anby/manifest-schema': minor
'@anby/cli': minor
---

Add isPlaceholderTenant helper + ./auth subpath export.

New auth helpers — isPlaceholderTenant(tenantId) returns true for known
non-real tenant sentinels ('default', '__legacy__', 'dev-tenant'). The set
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
