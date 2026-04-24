/**
 * AC (Anby Coin) credit events published by billing-service via event-router.
 * These are payload types — wrap in `AnbyEvent<T>` envelope when publishing.
 */

export type AcBucketPrimary = 'subscription' | 'topup' | 'mixed';

export interface AcGrantedEvent {
  workspaceId: string;
  cycleId: string;
  planSnapshot: string;
  grantedAmount: number;
  periodStart: string;
  periodEnd: string;
  balanceSubscriptionAfter: number;
}

export interface AcDebitedEvent {
  workspaceId: string;
  ledgerEntryId: string;
  amount: number;
  amountFromSubscription: number;
  amountFromTopup: number;
  bucketPrimary: AcBucketPrimary;
  jobId?: string;
  sourceService: string;
  balanceSubscriptionAfter: number;
  balanceTopupAfter: number;
  totalBalanceAfter: number;
}

export interface AcRefundedEvent {
  workspaceId: string;
  ledgerEntryId: string;
  refundForJobId: string;
  amount: number;
  reason: string;
  sourceService: string;
  balanceSubscriptionAfter: number;
  balanceTopupAfter: number;
}

export interface AcToppedUpEvent {
  workspaceId: string;
  topupId: string;
  polarOrderId: string;
  polarProductId: string;
  amountPurchased: number;
  amountPaidCents: number;
  currency: string;
  balanceTopupAfter: number;
}

export interface AcLowBalanceEvent {
  workspaceId: string;
  total: number;
  threshold: number;
  balanceSubscription: number;
  balanceTopup: number;
}

/**
 * Billing wallet + ledger entity types. Mirror of billing-service DB columns;
 * use for typing service-to-service payloads only — do NOT import in app
 * front-ends (they should call the SDK instead).
 */
export interface BillingWallet {
  workspaceId: string;
  balanceSubscription: number;
  balanceTopup: number;
  currentCycleId: string | null;
  polarCustomerId: string | null;
  updatedAt: string;
}

export interface BillingLedgerEntry {
  id: string;
  workspaceId: string;
  kind: 'grant' | 'topup' | 'debit' | 'refund' | 'cycle_expire' | 'admin_adjust';
  amountTotal: number;
  amountFromSubscription: number;
  amountFromTopup: number;
  bucketPrimary: AcBucketPrimary;
  balanceSubscriptionAfter: number;
  balanceTopupAfter: number;
  jobId: string | null;
  sourceService: string | null;
  idempotencyKey: string;
  createdAt: string;
}
