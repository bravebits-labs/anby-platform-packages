# @anby/billing

## 1.0.1

### Patch Changes

- 78b303a: Accept Prisma CUID workspace ids (in addition to UUIDs) at the SDK boundary.

  `DebitRequestSchema.workspaceId` and `RefundRequestSchema.workspaceId` previously
  used `z.string().uuid()`, which rejected the platform's actual tenant ids — they
  are CUIDs from `tenant-service`'s `Tenant.id @default(cuid())`. Calling
  `debitCredits()` with a real `user.tenantId` would therefore throw
  `ZodError` SDK-side before any HTTP request was sent.

  The relaxed predicate (`isWorkspaceId` / `workspaceIdSchema`) matches the
  server-side validator at `anby-billing-service/src/lib/workspace-id.ts`
  (UUID OR Prisma CUID, ≤128 chars). Both helpers are now exported from the
  package root for downstream consumers that want to pre-validate ids before
  SDK calls.

  This change strictly widens the accepted set — every UUID accepted by `1.0.0`
  remains valid in `1.0.1` — so it is fully backward-compatible.

## 1.0.0

### Major Changes

- d743e30: Initial public release of the Anby Billing SDK on npm (`1.0.0`).

  `@anby/billing` is the typed client for `anby-billing-service` — apps use it to record post-paid debits, query workspace balances, and read settled cycles without re-implementing HMAC signing or the `BillingError` envelope.

  What ships in `1.0.0`:

  - `BillingClient.debit(...)` — idempotent post-paid debit with `requestId` and `BillingError` typed responses (`INSUFFICIENT_FUNDS`, `IDEMPOTENT_REPLAY`, etc.).
  - `BillingClient.getBalance(workspaceId)` — current pool snapshot (subscription credits + topups + holds).
  - `BillingClient.listLedger(workspaceId, range)` — paginated cycle/event ledger with `ac.*` event types.
  - `ac.*` event type unions exported from `./types` for downstream consumers.
  - HMAC service-to-service signing is wired through `@anby/platform-sdk` so apps inherit the platform's auth posture.

  Aligned with `anby-billing-service` Phase 04b contract; depends on `@anby/contracts ^1.1.0` and `@anby/platform-sdk ^1.1.0`.
