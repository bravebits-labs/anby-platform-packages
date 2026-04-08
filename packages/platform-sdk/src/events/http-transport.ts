import type { AnbyEvent } from '@anby/contracts';
import { signAppRequest, type AppIdentity } from '../entities/identity.js';
import type { EventTransport } from './index.js';

/**
 * HttpEventTransport (PLAN-app-bootstrap-phase2 PR2).
 *
 * Replaces PostgresEventTransport for third-party apps. POSTs an AnbyEvent
 * envelope (or array, batched) to the platform's POST /registry/events
 * endpoint, signed with the app's per-request Ed25519 signature using the
 * canonical scheme:
 *
 *   ANBY-APP-V1\n{appId}\n{tenantId}\n{iso}\n{bodySha256}
 *
 * Headers attached:
 *   x-anby-app, x-anby-timestamp, x-anby-body-sha256, x-anby-signature
 *
 * Same scheme as POST /registry/scoped-token, so no scoped-token round-trip
 * is needed.
 *
 * Configured automatically by `bootstrapFromToken` once the discovery
 * response and the app's per-app private key are available. App code never
 * instantiates this directly.
 */
export class HttpEventTransport implements EventTransport {
  private readonly endpoint: string;
  private readonly identity: AppIdentity;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: {
    /** Full URL of POST /registry/events on the registry. */
    endpoint: string;
    /** Per-app identity from ANBY_APP_TOKEN. */
    identity: AppIdentity;
    /** Override for tests. */
    fetchImpl?: typeof fetch;
  }) {
    this.endpoint = opts.endpoint;
    this.identity = opts.identity;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error(
        'HttpEventTransport: no fetch implementation. Run on Node 18+ or pass fetchImpl.',
      );
    }
  }

  async publish(event: AnbyEvent): Promise<void> {
    // Body is the canonical JSON of the event envelope. The signed
    // body-hash is computed over these EXACT bytes — the receiver hashes
    // its raw request body and compares.
    const body = JSON.stringify(event);

    const headers = signAppRequest({
      identity: this.identity,
      tenantId: event.tenantId,
      body,
    });

    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...headers,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `HttpEventTransport: POST ${this.endpoint} failed with ${res.status}: ${text}`,
      );
    }
  }
}
