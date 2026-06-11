/**
 * Base class for all billing SDK errors. Consumers should check instanceof
 * against the specific subclass, not this base class.
 */
export class BillingError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Thrown when `configureBilling()` has not been called before an SDK call. */
export class BillingConfigurationError extends BillingError {
  constructor(message = 'configureBilling() must be called before using the SDK') {
    super('billing.not_configured', message, 0);
    this.name = 'BillingConfigurationError';
  }
}

/** Thrown for locally-invalid debit requests (zod validation). */
export class InvalidDebitRequestError extends BillingError {
  constructor(message: string, details?: unknown) {
    super('billing.invalid_request', message, 400, details);
    this.name = 'InvalidDebitRequestError';
  }
}

/** HTTP 402 — workspace wallet balance below required amount. */
export class InsufficientCreditsError extends BillingError {
  public readonly required: number;
  public readonly available: number;
  constructor(required: number, available: number, details?: unknown) {
    super(
      'billing.insufficient_credits',
      `Insufficient credits: required ${required} AC, available ${available} AC`,
      402,
      details,
    );
    this.name = 'InsufficientCreditsError';
    this.required = required;
    this.available = available;
  }
}

/** HTTP 409 — same jobId already processed (server returns prior entry in details). */
export class DuplicateRequestError extends BillingError {
  constructor(message: string, details?: unknown) {
    super('billing.duplicate_request', message, 409, details);
    this.name = 'DuplicateRequestError';
  }
}

/** HTTP 404 — workspace does not exist or has no wallet. */
export class WorkspaceNotFoundError extends BillingError {
  constructor(workspaceId: string) {
    super(
      'billing.workspace_not_found',
      `Workspace ${workspaceId} has no billing wallet`,
      404,
    );
    this.name = 'WorkspaceNotFoundError';
  }
}

/** HTTP 423 — wallet locked by admin (e.g. fraud review). */
export class WalletLockedError extends BillingError {
  constructor(workspaceId: string, reason?: string) {
    super(
      'billing.wallet_locked',
      `Wallet for workspace ${workspaceId} is locked${reason ? `: ${reason}` : ''}`,
      423,
    );
    this.name = 'WalletLockedError';
  }
}

/**
 * HTTP 409 `paid_plan_already_active` — the workspace already has an active paid
 * subscription, so a new subscription checkout cannot be opened. Distinct from
 * DuplicateRequestError (idempotency replay) — this is a business-state conflict.
 */
export class PlanAlreadyActiveError extends BillingError {
  constructor(message = 'Workspace already has an active paid plan', details?: unknown) {
    super('billing.paid_plan_already_active', message, 409, details);
    this.name = 'PlanAlreadyActiveError';
  }
}

/** HTTP 5xx or network error — billing-service unreachable / errored. */
export class BillingServiceUnavailableError extends BillingError {
  constructor(message: string, status = 503, details?: unknown) {
    super('billing.service_unavailable', message, status, details);
    this.name = 'BillingServiceUnavailableError';
  }
}
