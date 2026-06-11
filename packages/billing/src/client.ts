import { createHmac } from 'crypto';
import { signHmac } from '@anby/platform-sdk';
import {
  BalanceResult,
  BillingConfig,
  CheckoutResult,
  DebitRequest,
  DebitRequestSchema,
  DebitResult,
  RefundRequest,
  RefundRequestSchema,
  RefundResult,
  SubscriptionCheckoutRequest,
  TopupCheckoutRequest,
} from './types.js';
import {
  BillingConfigurationError,
  BillingError,
  BillingServiceUnavailableError,
  DuplicateRequestError,
  InsufficientCreditsError,
  InvalidDebitRequestError,
  PlanAlreadyActiveError,
  WalletLockedError,
  WorkspaceNotFoundError,
} from './errors.js';

let _config: BillingConfig | null = null;

/**
 * Initialize the billing SDK. Call once at service bootstrap.
 *
 * @throws {BillingConfigurationError} if `baseUrl` or `hmacSecret` is blank
 */
export function configureBilling(config: BillingConfig): void {
  if (!config.baseUrl) {
    throw new BillingConfigurationError('configureBilling: baseUrl is required');
  }
  if (!config.hmacSecret || config.hmacSecret.length < 32) {
    throw new BillingConfigurationError(
      'configureBilling: hmacSecret must be at least 32 characters',
    );
  }
  _config = { timeoutMs: 10_000, ...config };
}

/** @internal Reset config — test-only. */
export function _resetBillingConfig(): void {
  _config = null;
}

function getConfig(): BillingConfig {
  if (!_config) {
    throw new BillingConfigurationError();
  }
  return _config;
}

/**
 * Derive the API-level idempotency key from a business job id.
 * Format matches anby-billing-service expectation: `sha256(jobId + sourceService)`.
 */
export function deriveIdempotencyKey(jobId: string, sourceService: string): string {
  return createHmac('sha256', 'anby-billing-idemp').update(`${jobId}:${sourceService}`).digest('hex');
}

async function signedFetch(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string },
): Promise<Response> {
  const config = getConfig();
  const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
  const bodyText = init.body ? JSON.stringify(init.body) : '';
  const userValue = config.serviceName;
  const signature = signHmac(userValue, config.hmacSecret);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-internal-user': userValue,
    'x-internal-signature': signature,
  };
  if (init.idempotencyKey) {
    headers['idempotency-key'] = init.idempotencyKey;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);

  try {
    const fetchImpl = config.fetch ?? fetch;
    return await fetchImpl(url, {
      method: init.method,
      headers,
      body: bodyText || undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new BillingServiceUnavailableError('billing-service request timed out');
    }
    throw new BillingServiceUnavailableError(
      `billing-service unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function parseOrThrow(res: Response, workspaceIdForContext?: string): Promise<unknown> {
  const text = await res.text();
  let body: { error?: string; message?: string; details?: unknown } | null = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // non-JSON body — treat as opaque service error
    }
  }

  if (res.ok) return body;

  const message = body?.message ?? body?.error ?? `billing-service returned ${res.status}`;

  switch (res.status) {
    case 400:
      throw new InvalidDebitRequestError(message, body?.details);
    case 402: {
      const d = body?.details as { required?: number; available?: number } | undefined;
      throw new InsufficientCreditsError(d?.required ?? 0, d?.available ?? 0, body?.details);
    }
    case 404:
      throw new WorkspaceNotFoundError(workspaceIdForContext ?? 'unknown');
    case 409:
      throw new DuplicateRequestError(message, body?.details);
    case 423:
      throw new WalletLockedError(workspaceIdForContext ?? 'unknown', body?.details as string | undefined);
    default:
      if (res.status >= 500) {
        throw new BillingServiceUnavailableError(message, res.status, body?.details);
      }
      throw new BillingError('billing.unknown', message, res.status, body?.details);
  }
}

/**
 * Debit AC from a workspace wallet. Idempotent by `jobId` (per sourceService).
 *
 * @throws {InvalidDebitRequestError} if the request fails local zod validation
 * @throws {InsufficientCreditsError} 402 — wallet balance below amount
 * @throws {DuplicateRequestError} 409 — same jobId already processed
 * @throws {WorkspaceNotFoundError} 404 — no wallet for workspace
 * @throws {WalletLockedError} 423 — wallet locked by admin
 * @throws {BillingServiceUnavailableError} on 5xx or network error
 * @throws {BillingConfigurationError} if SDK not configured
 */
export async function debitCredits(request: DebitRequest): Promise<DebitResult> {
  const parsed = DebitRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new InvalidDebitRequestError(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      parsed.error.format(),
    );
  }
  const req = parsed.data;
  // Server mandates Idempotency-Key header (H2). Always derive one.
  const idempotencyKey =
    req.idempotencyKey ?? deriveIdempotencyKey(req.jobId, req.sourceService);

  const res = await signedFetch('/internal/billing/debits', {
    method: 'POST',
    body: {
      workspaceId: req.workspaceId,
      amount: req.amount,
      jobId: req.jobId,
      // sourceService intentionally omitted — server reads it from HMAC identity (B3).
      actorUserId: req.actorUserId,
      metadata: req.metadata ?? {},
    },
    idempotencyKey,
  });

  return (await parseOrThrow(res, req.workspaceId)) as DebitResult;
}

/**
 * Get current AC balance for a workspace wallet.
 *
 * @throws {WorkspaceNotFoundError} 404
 * @throws {BillingServiceUnavailableError} on 5xx or network error
 */
export async function getBalance(workspaceId: string): Promise<BalanceResult> {
  const res = await signedFetch(`/internal/billing/workspaces/${workspaceId}/balance`, {
    method: 'GET',
  });
  return (await parseOrThrow(res, workspaceId)) as BalanceResult;
}

/**
 * Refund (credit back) AC previously debited by the same service.
 * Idempotent — same `refundForJobId` returns the original refund entry.
 *
 * @throws {InvalidDebitRequestError} if local validation fails
 * @throws {DuplicateRequestError} 409 — this refund already issued
 * @throws {WorkspaceNotFoundError} 404
 * @throws {BillingServiceUnavailableError} on 5xx or network error
 */
export async function refundCredits(request: RefundRequest): Promise<RefundResult> {
  const parsed = RefundRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new InvalidDebitRequestError(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      parsed.error.format(),
    );
  }
  const req = parsed.data;
  const idempotencyKey = deriveIdempotencyKey(`refund:${req.refundForJobId}`, req.sourceService);

  const res = await signedFetch('/internal/billing/refunds', {
    method: 'POST',
    body: {
      workspaceId: req.workspaceId,
      refundForJobId: req.refundForJobId,
      reason: req.reason,
      // sourceService intentionally omitted — server reads it from HMAC identity (B3).
      actorUserId: req.actorUserId,
      metadata: req.metadata ?? {},
    },
    idempotencyKey,
  });

  return (await parseOrThrow(res, req.workspaceId)) as RefundResult;
}

/**
 * Parse a checkout response. Checkout endpoints have a different error contract
 * than ledger endpoints: 409 is a business-state conflict (paid plan already
 * active), not an idempotency replay, and 503 carries `product_not_configured`.
 */
async function parseCheckoutOrThrow(res: Response): Promise<CheckoutResult> {
  const text = await res.text();
  let body: { error?: string; message?: string; details?: unknown } | null = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // non-JSON body — treat as opaque service error
    }
  }

  if (res.ok) return body as unknown as CheckoutResult;

  const message = body?.message ?? body?.error ?? `billing-service returned ${res.status}`;

  switch (res.status) {
    case 400:
      throw new InvalidDebitRequestError(message, body?.details);
    case 409:
      throw new PlanAlreadyActiveError(message, body?.details);
    default:
      // 503 product_not_configured and any other 5xx map to unavailable.
      if (res.status >= 500) {
        throw new BillingServiceUnavailableError(message, res.status, body?.details);
      }
      throw new BillingError('billing.unknown', message, res.status, body?.details);
  }
}

/**
 * Open a Polar checkout for a paid subscription (Pro / Business). The returned
 * `checkoutUrl` is rendered by the in-app UpgradeDialog as an embedded checkout;
 * `embedOrigin` is forwarded so Polar can postMessage back to the host app.
 *
 * @throws {PlanAlreadyActiveError} 409 — workspace already on a paid plan
 * @throws {InvalidDebitRequestError} 400 — bad request (e.g. invalid returnUrl)
 * @throws {BillingServiceUnavailableError} 503 product_not_configured / 5xx / network
 * @throws {BillingConfigurationError} if SDK not configured
 */
export async function createSubscriptionCheckout(
  req: SubscriptionCheckoutRequest,
): Promise<CheckoutResult> {
  const res = await signedFetch('/internal/billing/subscriptions/checkout', {
    method: 'POST',
    body: {
      workspaceId: req.workspaceId,
      planCode: req.planCode,
      interval: req.interval,
      returnUrl: req.returnUrl,
      customerEmail: req.customerEmail,
      embedOrigin: req.embedOrigin,
    },
  });
  return parseCheckoutOrThrow(res);
}

/**
 * Open a Polar checkout for a one-time AC top-up package (mini / plus / max).
 * `embedOrigin` is forwarded for the in-app embedded checkout flow.
 *
 * @throws {InvalidDebitRequestError} 400 — unknown package or bad returnUrl
 * @throws {BillingServiceUnavailableError} 503 product_not_configured / 5xx / network
 * @throws {BillingConfigurationError} if SDK not configured
 */
export async function createTopupCheckout(
  req: TopupCheckoutRequest,
): Promise<CheckoutResult> {
  const res = await signedFetch('/internal/billing/topups/checkout', {
    method: 'POST',
    body: {
      workspaceId: req.workspaceId,
      package: req.package,
      returnUrl: req.returnUrl,
      customerEmail: req.customerEmail,
      embedOrigin: req.embedOrigin,
    },
  });
  return parseCheckoutOrThrow(res);
}
