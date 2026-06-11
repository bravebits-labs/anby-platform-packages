export {
  configureBilling,
  debitCredits,
  getBalance,
  refundCredits,
  deriveIdempotencyKey,
  createSubscriptionCheckout,
  createTopupCheckout,
  _resetBillingConfig,
} from './client.js';

export type {
  BillingConfig,
  DebitRequest,
  DebitResult,
  RefundRequest,
  RefundResult,
  BalanceResult,
  SourceService,
  BucketPrimary,
  SubscriptionCheckoutRequest,
  TopupCheckoutRequest,
  CheckoutResult,
} from './types.js';

export { isWorkspaceId, workspaceIdSchema } from './types.js';

export {
  BillingError,
  BillingConfigurationError,
  InvalidDebitRequestError,
  InsufficientCreditsError,
  DuplicateRequestError,
  WorkspaceNotFoundError,
  WalletLockedError,
  PlanAlreadyActiveError,
  BillingServiceUnavailableError,
} from './errors.js';
