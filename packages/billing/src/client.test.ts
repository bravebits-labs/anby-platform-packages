import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAuth } from '@anby/platform-sdk';
import {
  _resetBillingConfig,
  configureBilling,
  createSubscriptionCheckout,
  createTopupCheckout,
  debitCredits,
  deriveIdempotencyKey,
  getBalance,
  refundCredits,
} from './client.js';
import { isWorkspaceId, workspaceIdSchema } from './types.js';
import {
  BillingConfigurationError,
  BillingServiceUnavailableError,
  DuplicateRequestError,
  InsufficientCreditsError,
  InvalidDebitRequestError,
  PlanAlreadyActiveError,
  WalletLockedError,
  WorkspaceNotFoundError,
} from './errors.js';

const HMAC_SECRET = 'a'.repeat(48);
const BASE_URL = 'https://billing.test';
const WS = '11111111-2222-3333-4444-555555555555';
const USER = '99999999-8888-7777-6666-555555555555';

function mockFetch(response: { status: number; body: unknown }) {
  const impl = vi.fn(async () => ({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    text: async () => JSON.stringify(response.body),
  })) as unknown as typeof fetch;
  return impl;
}

function captureFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ledgerEntryId: 'ledger-1',
          amountDebited: 5,
          amountFromSubscription: 5,
          amountFromTopup: 0,
          bucketPrimary: 'subscription',
          balanceSubscriptionAfter: 295,
          balanceTopupAfter: 0,
          totalBalanceAfter: 295,
        }),
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('billing SDK', () => {
  beforeEach(() => {
    configureAuth({ hmacSecret: HMAC_SECRET });
  });
  afterEach(() => {
    _resetBillingConfig();
  });

  describe('configureBilling', () => {
    it('throws BillingConfigurationError with short secret', () => {
      expect(() =>
        configureBilling({ baseUrl: BASE_URL, hmacSecret: 'short', serviceName: 'meeting' }),
      ).toThrow(BillingConfigurationError);
    });

    it('accepts valid config', () => {
      expect(() =>
        configureBilling({ baseUrl: BASE_URL, hmacSecret: HMAC_SECRET, serviceName: 'meeting' }),
      ).not.toThrow();
    });
  });

  describe('debitCredits — validation', () => {
    beforeEach(() => {
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: mockFetch({ status: 200, body: {} }),
      });
    });

    it('rejects fractional amounts', async () => {
      await expect(
        debitCredits({
          workspaceId: WS,
          amount: 0.5,
          jobId: 'j1',
          sourceService: 'meeting',
        }),
      ).rejects.toBeInstanceOf(InvalidDebitRequestError);
    });

    it('rejects zero amount', async () => {
      await expect(
        debitCredits({
          workspaceId: WS,
          amount: 0,
          jobId: 'j1',
          sourceService: 'meeting',
        }),
      ).rejects.toBeInstanceOf(InvalidDebitRequestError);
    });

    it('rejects missing jobId AND idempotencyKey', async () => {
      await expect(
        debitCredits({
          workspaceId: WS,
          amount: 5,
          sourceService: 'meeting',
        } as never),
      ).rejects.toBeInstanceOf(InvalidDebitRequestError);
    });
  });

  describe('debitCredits — request shape', () => {
    it('sends HMAC signature + idempotency-key header', async () => {
      const { impl, calls } = captureFetch();
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: impl,
      });

      await debitCredits({
        workspaceId: WS,
        amount: 5,
        jobId: 'meeting-summary:abc',
        sourceService: 'meeting',
        actorUserId: USER,
        metadata: { meetingId: 'm1' },
      });

      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.url).toBe('https://billing.test/internal/billing/debits');
      const headers = call.init.headers as Record<string, string>;
      expect(headers['x-internal-user']).toBe('meeting');
      expect(headers['x-internal-signature']).toMatch(/^[a-f0-9]{64}$/);
      expect(headers['idempotency-key']).toMatch(/^[a-f0-9]{64}$/);

      const body = JSON.parse(call.init.body as string);
      // sourceService intentionally omitted — server reads it from HMAC identity (B3).
      expect(body).toMatchObject({
        workspaceId: WS,
        amount: 5,
        jobId: 'meeting-summary:abc',
        actorUserId: USER,
        metadata: { meetingId: 'm1' },
      });
      expect(body.sourceService).toBeUndefined();
    });
  });

  describe('debitCredits — error mapping', () => {
    function setup(status: number, body: unknown) {
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: mockFetch({ status, body }),
      });
    }

    const req = {
      workspaceId: WS,
      amount: 5,
      jobId: 'j',
      sourceService: 'meeting' as const,
    };

    it('maps 402 to InsufficientCreditsError with required/available', async () => {
      setup(402, {
        error: 'insufficient',
        message: 'not enough',
        details: { required: 5, available: 2 },
      });
      try {
        await debitCredits(req);
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(InsufficientCreditsError);
        expect((err as InsufficientCreditsError).required).toBe(5);
        expect((err as InsufficientCreditsError).available).toBe(2);
      }
    });

    it('maps 409 to DuplicateRequestError', async () => {
      setup(409, { message: 'duplicate jobId' });
      await expect(debitCredits(req)).rejects.toBeInstanceOf(DuplicateRequestError);
    });

    it('maps 404 to WorkspaceNotFoundError', async () => {
      setup(404, { message: 'missing' });
      await expect(debitCredits(req)).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    });

    it('maps 423 to WalletLockedError', async () => {
      setup(423, { message: 'locked' });
      await expect(debitCredits(req)).rejects.toBeInstanceOf(WalletLockedError);
    });

    it('maps 503 to BillingServiceUnavailableError', async () => {
      setup(503, { message: 'down' });
      await expect(debitCredits(req)).rejects.toBeInstanceOf(BillingServiceUnavailableError);
    });

    it('throws BillingServiceUnavailableError on network failure', async () => {
      const failing = vi.fn(async () => {
        throw new Error('ENOTFOUND');
      }) as unknown as typeof fetch;
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: failing,
      });
      await expect(debitCredits(req)).rejects.toBeInstanceOf(BillingServiceUnavailableError);
    });
  });

  describe('getBalance', () => {
    it('sends GET with HMAC headers', async () => {
      const { impl, calls } = captureFetch();
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: impl,
      });

      await getBalance(WS);

      expect(calls).toHaveLength(1);
      expect(calls[0]!.init.method).toBe('GET');
      expect(calls[0]!.url).toBe(`https://billing.test/internal/billing/workspaces/${WS}/balance`);
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers['x-internal-signature']).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('refundCredits', () => {
    it('requires reason and refundForJobId', async () => {
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: mockFetch({ status: 200, body: {} }),
      });

      await expect(
        refundCredits({
          workspaceId: WS,
          refundForJobId: '',
          reason: 'any',
          sourceService: 'meeting',
        }),
      ).rejects.toBeInstanceOf(InvalidDebitRequestError);
    });
  });

  describe('deriveIdempotencyKey', () => {
    it('is deterministic for same inputs', () => {
      const a = deriveIdempotencyKey('job-1', 'meeting');
      const b = deriveIdempotencyKey('job-1', 'meeting');
      expect(a).toBe(b);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
    });

    it('differs per source service', () => {
      expect(deriveIdempotencyKey('job-1', 'meeting')).not.toBe(
        deriveIdempotencyKey('job-1', 'okr'),
      );
    });
  });

  describe('configuration guard', () => {
    it('throws BillingConfigurationError when SDK not configured', async () => {
      await expect(getBalance(WS)).rejects.toBeInstanceOf(BillingConfigurationError);
    });
  });

  describe('createSubscriptionCheckout', () => {
    function captureFetchOk(body: unknown) {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      const impl = vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      }) as unknown as typeof fetch;
      return { impl, calls };
    }

    const RETURN_URL = 'https://meet.anby.ai/billing/return';

    it('posts signed request with planCode/interval/embedOrigin and returns checkoutUrl', async () => {
      const { impl, calls } = captureFetchOk({
        checkoutUrl: 'https://polar.sh/c/sub',
        checkoutId: 'co_sub',
        expiresAt: '2026-06-12T00:00:00.000Z',
      });
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: impl,
      });

      const r = await createSubscriptionCheckout({
        workspaceId: WS,
        planCode: 'pro',
        interval: 'monthly',
        returnUrl: RETURN_URL,
        customerEmail: 'user@anby.ai',
        embedOrigin: 'https://meet.anby.ai',
      });

      expect(r.checkoutUrl).toBe('https://polar.sh/c/sub');
      expect(r.checkoutId).toBe('co_sub');
      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.url).toBe('https://billing.test/internal/billing/subscriptions/checkout');
      const headers = call.init.headers as Record<string, string>;
      expect(headers['x-internal-signature']).toMatch(/^[a-f0-9]{64}$/);
      const body = JSON.parse(call.init.body as string);
      expect(body).toMatchObject({
        workspaceId: WS,
        planCode: 'pro',
        interval: 'monthly',
        returnUrl: RETURN_URL,
        customerEmail: 'user@anby.ai',
        embedOrigin: 'https://meet.anby.ai',
      });
    });

    it('maps 409 paid_plan_already_active to PlanAlreadyActiveError', async () => {
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: mockFetch({ status: 409, body: { error: 'paid_plan_already_active' } }),
      });
      await expect(
        createSubscriptionCheckout({
          workspaceId: WS,
          planCode: 'pro',
          interval: 'monthly',
          returnUrl: RETURN_URL,
        }),
      ).rejects.toBeInstanceOf(PlanAlreadyActiveError);
    });

    it('maps 503 product_not_configured to BillingServiceUnavailableError', async () => {
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: mockFetch({ status: 503, body: { error: 'product_not_configured' } }),
      });
      await expect(
        createSubscriptionCheckout({ workspaceId: WS, planCode: 'business', returnUrl: RETURN_URL }),
      ).rejects.toBeInstanceOf(BillingServiceUnavailableError);
    });

    it('maps 500 product_not_configured to BillingServiceUnavailableError', async () => {
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: mockFetch({ status: 500, body: { error: 'product_not_configured' } }),
      });
      await expect(
        createSubscriptionCheckout({ workspaceId: WS, planCode: 'business', returnUrl: RETURN_URL }),
      ).rejects.toBeInstanceOf(BillingServiceUnavailableError);
    });

    it('throws BillingServiceUnavailableError on 200 missing checkoutUrl', async () => {
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: mockFetch({ status: 200, body: {} }),
      });
      await expect(
        createSubscriptionCheckout({ workspaceId: WS, planCode: 'pro', returnUrl: RETURN_URL }),
      ).rejects.toBeInstanceOf(BillingServiceUnavailableError);
    });

    it('maps 400 bad request to InvalidDebitRequestError', async () => {
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: mockFetch({ status: 400, body: { error: 'bad_request' } }),
      });
      await expect(
        createSubscriptionCheckout({ workspaceId: WS, planCode: 'pro', returnUrl: RETURN_URL }),
      ).rejects.toBeInstanceOf(InvalidDebitRequestError);
    });
  });

  describe('createTopupCheckout', () => {
    function captureFetchOk(body: unknown) {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      const impl = vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      }) as unknown as typeof fetch;
      return { impl, calls };
    }

    const RETURN_URL = 'https://meet.anby.ai/billing/return';

    it('posts signed request and returns checkoutUrl', async () => {
      const { impl, calls } = captureFetchOk({
        checkoutUrl: 'https://polar.sh/c/x',
        checkoutId: 'co_1',
        expiresAt: '2026-06-12T00:00:00.000Z',
        package: 'plus',
        acAmount: 500,
      });
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: impl,
      });

      const r = await createTopupCheckout({
        workspaceId: WS,
        package: 'plus',
        returnUrl: RETURN_URL,
        embedOrigin: 'https://meet.anby.ai',
      });

      expect(r.checkoutUrl).toBe('https://polar.sh/c/x');
      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.url).toBe('https://billing.test/internal/billing/topups/checkout');
      const body = JSON.parse(call.init.body as string);
      expect(body).toMatchObject({
        workspaceId: WS,
        package: 'plus',
        returnUrl: RETURN_URL,
        embedOrigin: 'https://meet.anby.ai',
      });
    });

    it('maps 400 unknown package to InvalidDebitRequestError', async () => {
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: mockFetch({ status: 400, body: { error: 'unknown_package' } }),
      });
      await expect(
        createTopupCheckout({ workspaceId: WS, package: 'mini', returnUrl: RETURN_URL }),
      ).rejects.toBeInstanceOf(InvalidDebitRequestError);
    });

    it('maps 503 product_not_configured to BillingServiceUnavailableError', async () => {
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: mockFetch({ status: 503, body: { error: 'product_not_configured' } }),
      });
      await expect(
        createTopupCheckout({ workspaceId: WS, package: 'max', returnUrl: RETURN_URL }),
      ).rejects.toBeInstanceOf(BillingServiceUnavailableError);
    });
  });

  describe('workspaceId acceptance (mirrors billing-service workspace-id.ts)', () => {
    it('accepts RFC-4122 UUID', () => {
      expect(isWorkspaceId('11111111-2222-3333-4444-555555555555')).toBe(true);
      expect(workspaceIdSchema.safeParse('11111111-2222-3333-4444-555555555555').success).toBe(true);
    });

    it('accepts Prisma CUID (current platform tenant id format)', () => {
      const cuid = 'clx1n3z2x000007l8gj0vb6t9';
      expect(isWorkspaceId(cuid)).toBe(true);
      expect(workspaceIdSchema.safeParse(cuid).success).toBe(true);
    });

    it('rejects strings that are neither UUID nor CUID', () => {
      expect(isWorkspaceId('default')).toBe(false);
      expect(isWorkspaceId('')).toBe(false);
      expect(isWorkspaceId('not-a-real-id')).toBe(false);
      expect(workspaceIdSchema.safeParse('default').success).toBe(false);
    });

    it('rejects values exceeding 128 chars (DB column width)', () => {
      const tooLong = 'c' + 'a'.repeat(140);
      expect(isWorkspaceId(tooLong)).toBe(false);
    });

    it('debitCredits no longer rejects CUID workspace ids at SDK boundary', async () => {
      const fetchImpl = mockFetch({
        status: 200,
        body: {
          ledgerEntryId: 'le_1',
          amountDebited: 3,
          amountFromSubscription: 3,
          amountFromTopup: 0,
          bucketPrimary: 'subscription',
          balanceSubscriptionAfter: 297,
          balanceTopupAfter: 0,
          totalBalanceAfter: 297,
        },
      });
      configureBilling({
        baseUrl: BASE_URL,
        hmacSecret: HMAC_SECRET,
        serviceName: 'meeting',
        fetch: fetchImpl,
      });
      await expect(
        debitCredits({
          workspaceId: 'clx1n3z2x000007l8gj0vb6t9',
          amount: 3,
          jobId: 'meeting-summary:m_1',
          sourceService: 'meeting',
        }),
      ).resolves.toMatchObject({ amountDebited: 3 });
    });
  });
});
