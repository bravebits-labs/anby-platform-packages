# @anby/billing

Typed SDK for calling `anby-billing-service` from Anby services. Handles HMAC signing, request shape validation, idempotency derivation, and error mapping.

## Install

```bash
npm add @anby/billing @anby/platform-sdk
```

`@anby/platform-sdk` is a peer dependency — it owns the HMAC signer.

## Bootstrap (once per service)

```ts
import { configureAuth } from '@anby/platform-sdk';
import { configureBilling } from '@anby/billing';

configureAuth({ hmacSecret: process.env.SVC_HMAC_SECRET });

configureBilling({
  baseUrl: process.env.BILLING_SERVICE_URL,     // https://billing.anby.ai
  hmacSecret: process.env.SVC_HMAC_SECRET,      // 32+ chars, shared with billing-service
  serviceName: 'meeting',                        // source of debits
});
```

## Debit AC

```ts
import { debitCredits, InsufficientCreditsError } from '@anby/billing';

try {
  const result = await debitCredits({
    workspaceId: meeting.workspaceId,
    amount: 5,                                          // integer, whole AC
    jobId: `meeting-summary:${meeting.id}`,             // business identifier, unique per service
    sourceService: 'meeting',
    actorUserId: currentUser.id,
    metadata: {
      meetingId: meeting.id,
      aiModel: 'gpt-5.4',
      durationMinutes: 60,
    },
  });
  console.log(`AC balance: ${result.totalBalanceAfter}`);
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    // show paywall / upsell CTA. err.required, err.available available
  }
  throw err;
}
```

Calling `debitCredits` twice with the same `(jobId, sourceService)` returns the same `ledgerEntryId` both times — safe to retry on transient failures.

## Get balance

```ts
const balance = await getBalance(workspaceId);
// { balanceSubscription, balanceTopup, total, cycle: { planSnapshot, periodEnd, ... } }
```

## Refund (AI failure / admin adjust)

```ts
import { refundCredits } from '@anby/billing';

await refundCredits({
  workspaceId,
  refundForJobId: `meeting-summary:${meeting.id}`,
  reason: 'AI provider timeout',
  sourceService: 'meeting',
});
```

## Errors

All errors extend `BillingError` with `.code`, `.status`, `.details`:

| Class | HTTP | When |
|-------|------|------|
| `BillingConfigurationError` | — | SDK not configured or invalid config |
| `InvalidDebitRequestError` | 400 | Zod validation fails locally or server rejects shape |
| `InsufficientCreditsError` | 402 | Balance below amount. `.required`, `.available` available |
| `WorkspaceNotFoundError` | 404 | No wallet for workspace |
| `DuplicateRequestError` | 409 | Same jobId already processed (server returns prior entry in `.details`) |
| `WalletLockedError` | 423 | Wallet frozen (admin action, fraud review) |
| `BillingServiceUnavailableError` | 5xx/network | Treat as retryable. SDK does not auto-retry |

## Idempotency

- `jobId` is your **business-meaningful** identifier (e.g. `meeting-summary:<meetingId>`). One debit per `(jobId, sourceService)` globally.
- `idempotencyKey` is the **API-level** key. SDK derives it as `sha256(jobId + sourceService)` if you don't pass one. 24h TTL server-side.
- Pass `idempotencyKey` directly only if upstream (queue) already has a stable id. Most callers should only pass `jobId`.

## Design notes

- **No auto-retry**: caller decides. Billing is money-critical; silent retry could obscure balance bugs.
- **Timeout default 10s**: tunable via `timeoutMs` in `configureBilling`.
- **Integer AC**: fractional amounts rejected locally. See `docs/billing-system.md` for the "round up to 1 AC" policy rationale.
