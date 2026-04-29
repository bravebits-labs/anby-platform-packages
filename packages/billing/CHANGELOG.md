# @anby/billing

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
