import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync, createPublicKey, verify, createHash } from 'node:crypto';
import { HttpEventTransport } from './http-transport.js';
import { canonicalSigString, hashBody } from '../entities/identity.js';
import type { AnbyEvent } from '@anby/contracts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const APP_ID = 'com.test.example';

function makeEvent(overrides: Partial<AnbyEvent> = {}): AnbyEvent {
  return {
    id: 'evt-' + Math.random().toString(36).slice(2),
    type: 'org.test.created',
    source: APP_ID,
    tenantId: 'tenant-1',
    timestamp: new Date().toISOString(),
    version: '1',
    correlationId: 'corr-1',
    actor: { userId: 'u1', email: 'u1@x.com' },
    data: { foo: 'bar' },
    ...overrides,
  };
}

interface CapturedCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function captureFetch(): { calls: CapturedCall[]; impl: typeof fetch } {
  const calls: CapturedCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const headers: Record<string, string> = {};
    const initHeaders = init?.headers;
    if (initHeaders && typeof initHeaders === 'object') {
      for (const [k, v] of Object.entries(initHeaders)) {
        headers[k.toLowerCase()] = String(v);
      }
    }
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url: u, headers, body });
    return new Response('{"accepted":1,"duplicates":0}', {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, impl };
}

describe('HttpEventTransport', () => {
  let transport: HttpEventTransport;
  let captured: ReturnType<typeof captureFetch>;

  beforeEach(() => {
    captured = captureFetch();
    transport = new HttpEventTransport({
      endpoint: 'https://anby.test/registry/events',
      identity: { appId: APP_ID, privateKeyPem },
      fetchImpl: captured.impl,
    });
  });

  it('POSTs the event envelope as JSON', async () => {
    await transport.publish(makeEvent());
    expect(captured.calls).toHaveLength(1);
    const call = captured.calls[0];
    expect(call.url).toBe('https://anby.test/registry/events');
    expect(call.headers['content-type']).toBe('application/json');
    const body = JSON.parse(call.body);
    expect(body.type).toBe('org.test.created');
    expect(body.tenantId).toBe('tenant-1');
  });

  it('attaches the four signed headers', async () => {
    await transport.publish(makeEvent());
    const call = captured.calls[0];
    expect(call.headers['x-anby-app']).toBe(APP_ID);
    expect(call.headers['x-anby-timestamp']).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(call.headers['x-anby-body-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(call.headers['x-anby-signature']).toBeTruthy();
  });

  it('CRITICAL: x-anby-body-sha256 matches the actual body bytes', async () => {
    await transport.publish(makeEvent());
    const call = captured.calls[0];
    const actualHash = hashBody(call.body);
    expect(call.headers['x-anby-body-sha256']).toBe(actualHash);
  });

  it('CRITICAL: signature is a valid Ed25519 signature over the canonical string', async () => {
    const event = makeEvent();
    await transport.publish(event);
    const call = captured.calls[0];
    const canonical = canonicalSigString({
      callerAppId: APP_ID,
      tenantId: event.tenantId,
      isoTimestamp: call.headers['x-anby-timestamp'],
      bodySha256: call.headers['x-anby-body-sha256'],
    });
    const sig = Buffer.from(call.headers['x-anby-signature'], 'base64');
    const ok = verify(null, Buffer.from(canonical), createPublicKey(publicKeyPem), sig);
    expect(ok).toBe(true);
  });

  it('uses the tenantId from the event for signing', async () => {
    const event = makeEvent({ tenantId: 'tenant-different' });
    await transport.publish(event);
    const call = captured.calls[0];
    const canonical = canonicalSigString({
      callerAppId: APP_ID,
      tenantId: 'tenant-different',
      isoTimestamp: call.headers['x-anby-timestamp'],
      bodySha256: call.headers['x-anby-body-sha256'],
    });
    const sig = Buffer.from(call.headers['x-anby-signature'], 'base64');
    const ok = verify(null, Buffer.from(canonical), createPublicKey(publicKeyPem), sig);
    expect(ok).toBe(true);
  });

  it('throws on non-ok response', async () => {
    const failFetch = (async () =>
      new Response('forbidden', { status: 403 })) as typeof fetch;
    const t = new HttpEventTransport({
      endpoint: 'https://anby.test/registry/events',
      identity: { appId: APP_ID, privateKeyPem },
      fetchImpl: failFetch,
    });
    await expect(t.publish(makeEvent())).rejects.toThrow(/403/);
  });
});
