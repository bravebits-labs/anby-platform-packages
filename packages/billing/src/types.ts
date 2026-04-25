import { z } from 'zod';

/**
 * Source services that may debit/credit AC. Used in audit trail + observability.
 * Note: the server derives `sourceService` from the HMAC-authenticated identity
 * (x-internal-user header) — it never trusts a `sourceService` field in the body.
 */
export const SourceServiceSchema = z.enum([
  'meeting',
  'okr',
  'god-brain',
  'admin',
  'platform',
]);
export type SourceService = z.infer<typeof SourceServiceSchema>;

/**
 * Bucket from which AC was primarily debited (for reporting / refund logic).
 */
export type BucketPrimary = 'subscription' | 'topup' | 'mixed';

/**
 * A debit request. Amount must be a positive integer (AC units are whole).
 *
 * `jobId` is REQUIRED (business-level dedup). The SDK always derives an
 * Idempotency-Key header from the jobId — you can override via `idempotencyKey`.
 */
export const DebitRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  amount: z
    .number()
    .int('AC amounts must be whole integers — fractional AC is not supported')
    .positive('AC amount must be greater than zero'),
  /**
   * Business-meaningful job identifier. REQUIRED. Two debits with the same
   * `(jobId, sourceService)` are deduplicated by the server.
   */
  jobId: z.string().min(1).max(255),
  /**
   * API-level idempotency key. Derived by the SDK when omitted. 24h TTL on server.
   */
  idempotencyKey: z.string().min(1).max(255).optional(),
  sourceService: SourceServiceSchema,
  actorUserId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type DebitRequest = z.infer<typeof DebitRequestSchema>;

export interface DebitResult {
  ledgerEntryId: string;
  amountDebited: number;
  amountFromSubscription: number;
  amountFromTopup: number;
  bucketPrimary: BucketPrimary;
  balanceSubscriptionAfter: number;
  balanceTopupAfter: number;
  totalBalanceAfter: number;
}

/**
 * Refund / credit-back request. Matches a prior debit by (workspaceId,
 * refundForJobId, sourceService) — server rejects refunds that don't match all
 * three (prevents cross-workspace refund forgery).
 */
export const RefundRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  refundForJobId: z.string().min(1).max(255),
  reason: z.string().min(1).max(500),
  sourceService: SourceServiceSchema,
  actorUserId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type RefundRequest = z.infer<typeof RefundRequestSchema>;

export interface RefundResult {
  ledgerEntryId: string;
  amountRefunded: number;
  amountToSubscription: number;
  amountToTopup: number;
  bucketPrimary: BucketPrimary;
  balanceSubscriptionAfter: number;
  balanceTopupAfter: number;
  totalBalanceAfter: number;
}

export interface BalanceResult {
  workspaceId: string;
  balanceSubscription: number;
  balanceTopup: number;
  total: number;
  plan: string;
  isCanceled: boolean;
  cycle: {
    id: string;
    periodStart: string;
    periodEnd: string;
    grantedAmount: number;
    canceledAt: string | null;
  } | null;
}

export interface BillingConfig {
  /** Base URL of anby-billing-service, e.g. https://billing.anby.ai */
  baseUrl: string;
  /** Shared HMAC secret (32+ chars, matches billing-service SVC_HMAC_SECRET env) */
  hmacSecret: string;
  /** Identifier of the calling service, used as the HMAC user value */
  serviceName: SourceService;
  /** Optional custom fetch for testing / non-node runtimes */
  fetch?: typeof fetch;
  /** Request timeout in ms (default 10000) */
  timeoutMs?: number;
}
