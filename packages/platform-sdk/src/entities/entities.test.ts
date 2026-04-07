import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import {
  EntityNotInstalledError,
  InMemoryEntityCache,
  entityCacheKey,
  configureAppIdentity,
  _resetAppIdentity,
  signAppRequest,
  verifyAppRequest,
  generateAppKeyPair,
  hashBody,
  canonicalSigString,
  parseEntityRequires,
  qualifyEntity,
  resolveEntityProvider,
  _injectEntityMap,
  _clearResolver,
  SharedSecretVerifier,
  dispatchEntityRequest,
  type EntityHandlerRegistration,
  type ScopedTokenClaims,
  registerEntitySchema,
  validateEntityPayload,
  schemaChecksum,
  _resetSchemaCache,
} from './index.js';

// Speed up: force validation off during unrelated tests, on where we need it.
const OLD_ENV = { ...process.env };

beforeEach(() => {
  _clearResolver();
  _resetAppIdentity();
  _resetSchemaCache();
  process.env = { ...OLD_ENV };
});

afterEach(() => {
  _clearResolver();
  _resetAppIdentity();
  _resetSchemaCache();
});

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

describe('resolver', () => {
  it('throws EntityNotInstalledError when map missing', () => {
    expect(() => resolveEntityProvider('T1', 'org.period', 'v1')).toThrow(
      EntityNotInstalledError,
    );
  });

  it('throws EntityNotInstalledError when entity missing', () => {
    _injectEntityMap('T1', {});
    expect(() => resolveEntityProvider('T1', 'org.period', 'v1')).toThrow(
      EntityNotInstalledError,
    );
  });

  it('returns entry when present', () => {
    _injectEntityMap('T1', {
      'org.period@v1': {
        appId: 'com.bravebits.org-chart',
        baseUrl: 'http://org-chart:3002',
        entityName: 'org.period',
        version: 'v1',
        schema: null,
      },
    });
    const entry = resolveEntityProvider('T1', 'org.period', 'v1');
    expect(entry.appId).toBe('com.bravebits.org-chart');
    expect(entry.baseUrl).toBe('http://org-chart:3002');
  });

  it('isolates tenants — T1 map not visible to T2', () => {
    _injectEntityMap('T1', {
      'org.period@v1': {
        appId: 'com.bravebits.org-chart',
        baseUrl: 'http://org-chart-T1',
        entityName: 'org.period',
        version: 'v1',
        schema: null,
      },
    });
    expect(() => resolveEntityProvider('T2', 'org.period', 'v1')).toThrow(
      EntityNotInstalledError,
    );
  });
});

// ---------------------------------------------------------------------------
// Per-app identity (CR-1)
// ---------------------------------------------------------------------------

describe('app identity signatures', () => {
  it('signs and verifies a round trip', () => {
    const kp = generateAppKeyPair();
    const identity = { appId: 'com.test.app', privateKeyPem: kp.privateKeyPem };
    const body = JSON.stringify({ tenantId: 'T1', scope: 'entity.read' });
    const headers = signAppRequest({ identity, tenantId: 'T1', body });
    const result = verifyAppRequest({
      claimedAppId: 'com.test.app',
      tenantId: 'T1',
      publicKeyPem: kp.publicKeyPem,
      headers,
      bodyRaw: body,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when claimedAppId does not match the signed header', () => {
    const kp = generateAppKeyPair();
    const identity = { appId: 'com.test.real', privateKeyPem: kp.privateKeyPem };
    const body = '{}';
    const headers = signAppRequest({ identity, tenantId: 'T1', body });
    const result = verifyAppRequest({
      claimedAppId: 'com.test.attacker', // mismatch
      tenantId: 'T1',
      publicKeyPem: kp.publicKeyPem,
      headers,
      bodyRaw: body,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/header app id/i);
    }
  });

  it('rejects signature made with a different private key (CRITICAL)', () => {
    const kpReal = generateAppKeyPair();
    const kpAttacker = generateAppKeyPair();
    const identity = {
      appId: 'com.test.app',
      privateKeyPem: kpAttacker.privateKeyPem,
    };
    const body = '{}';
    const headers = signAppRequest({ identity, tenantId: 'T1', body });
    const result = verifyAppRequest({
      claimedAppId: 'com.test.app',
      tenantId: 'T1',
      publicKeyPem: kpReal.publicKeyPem, // real app's public key
      headers,
      bodyRaw: body,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects replay with a different body', () => {
    const kp = generateAppKeyPair();
    const identity = { appId: 'com.test.app', privateKeyPem: kp.privateKeyPem };
    const originalBody = JSON.stringify({ tenantId: 'T1' });
    const headers = signAppRequest({ identity, tenantId: 'T1', body: originalBody });
    const result = verifyAppRequest({
      claimedAppId: 'com.test.app',
      tenantId: 'T1',
      publicKeyPem: kp.publicKeyPem,
      headers,
      bodyRaw: JSON.stringify({ tenantId: 'T1', evil: true }),
    });
    expect(result.ok).toBe(false);
  });

  it('rejects expired timestamp', () => {
    const kp = generateAppKeyPair();
    const identity = { appId: 'com.test.app', privateKeyPem: kp.privateKeyPem };
    const body = '{}';
    const oldTime = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    const headers = signAppRequest({ identity, tenantId: 'T1', body, now: oldTime });
    const result = verifyAppRequest({
      claimedAppId: 'com.test.app',
      tenantId: 'T1',
      publicKeyPem: kp.publicKeyPem,
      headers,
      bodyRaw: body,
    });
    expect(result.ok).toBe(false);
  });

  it('canonicalSigString is deterministic', () => {
    const a = canonicalSigString({
      callerAppId: 'x',
      tenantId: 'y',
      isoTimestamp: 'z',
      bodySha256: 'w',
    });
    const b = canonicalSigString({
      callerAppId: 'x',
      tenantId: 'y',
      isoTimestamp: 'z',
      bodySha256: 'w',
    });
    expect(a).toBe(b);
    expect(a).toContain('ANBY-APP-V1');
  });

  it('hashBody of empty body is sha256("")', () => {
    const empty = hashBody('');
    expect(empty).toBe(
      crypto.createHash('sha256').update('').digest('hex'),
    );
  });
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

describe('InMemoryEntityCache', () => {
  it('stores and retrieves by key', () => {
    const c = new InMemoryEntityCache({ defaultTtlMs: 60_000 });
    c.set('a', { v: 1 });
    expect(c.get('a')).toEqual({ v: 1 });
  });

  it('expires after TTL', async () => {
    const c = new InMemoryEntityCache({ defaultTtlMs: 1 });
    c.set('a', { v: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(c.get('a')).toBeUndefined();
  });

  it('del removes by key', () => {
    const c = new InMemoryEntityCache();
    c.set('a', 1);
    c.del('a');
    expect(c.get('a')).toBeUndefined();
  });

  it('delPattern clears entries by prefix', () => {
    const c = new InMemoryEntityCache();
    c.set('T1:org.period@v1:hash1', 1);
    c.set('T1:org.period@v1:hash2', 2);
    c.set('T2:org.period@v1:hash3', 3);
    c.delPattern('T1:org.period@v1:');
    expect(c.get('T1:org.period@v1:hash1')).toBeUndefined();
    expect(c.get('T1:org.period@v1:hash2')).toBeUndefined();
    expect(c.get('T2:org.period@v1:hash3')).toBe(3);
  });

  it('evicts oldest beyond maxEntries', () => {
    const c = new InMemoryEntityCache({ maxEntries: 2, defaultTtlMs: 60_000 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });
});

describe('entityCacheKey', () => {
  it('is stable across query field order', () => {
    const k1 = entityCacheKey('T1', 'org.period', 'v1', '/', { a: 1, b: 2 });
    const k2 = entityCacheKey('T1', 'org.period', 'v1', '/', { b: 2, a: 1 });
    expect(k1).toBe(k2);
  });

  it('differs when tenant changes', () => {
    const k1 = entityCacheKey('T1', 'org.period', 'v1', '/');
    const k2 = entityCacheKey('T2', 'org.period', 'v1', '/');
    expect(k1).not.toBe(k2);
  });
});

// ---------------------------------------------------------------------------
// Entity name parsing
// ---------------------------------------------------------------------------

describe('parseEntityRequires', () => {
  it('defaults to v1 when no @ suffix', () => {
    expect(parseEntityRequires('org.period')).toEqual({
      name: 'org.period',
      version: 'v1',
    });
  });

  it('parses explicit version', () => {
    expect(parseEntityRequires('org.period@v2')).toEqual({
      name: 'org.period',
      version: 'v2',
    });
  });
});

describe('qualifyEntity', () => {
  it('joins name and version', () => {
    expect(qualifyEntity('org.period', 'v1')).toBe('org.period@v1');
  });
});

// ---------------------------------------------------------------------------
// JSON schema validation
// ---------------------------------------------------------------------------

describe('entity schema', () => {
  it('passes when schema matches payload', async () => {
    process.env.PLATFORM_ENTITY_VALIDATE = '1';
    await registerEntitySchema('org.period', 'v1', {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    });
    expect(() =>
      validateEntityPayload('org.period', 'v1', { id: 'p1', name: 'Q1' }),
    ).not.toThrow();
  });

  it('throws when payload violates schema', async () => {
    process.env.PLATFORM_ENTITY_VALIDATE = '1';
    await registerEntitySchema('org.period', 'v1', {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    });
    expect(() =>
      validateEntityPayload('org.period', 'v1', { wrong: true }),
    ).toThrow(/violated schema/);
  });

  it('validates each item in an array response', async () => {
    process.env.PLATFORM_ENTITY_VALIDATE = '1';
    await registerEntitySchema('org.period', 'v1', {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    });
    expect(() =>
      validateEntityPayload('org.period', 'v1', [{ id: 'a' }, { id: 'b' }]),
    ).not.toThrow();
    expect(() =>
      validateEntityPayload('org.period', 'v1', [{ id: 'a' }, { wrong: true }]),
    ).toThrow();
  });

  it('is disabled in production without the override', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PLATFORM_ENTITY_VALIDATE;
    await registerEntitySchema('org.period', 'v1', {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    });
    expect(() =>
      validateEntityPayload('org.period', 'v1', { wrong: true }),
    ).not.toThrow();
  });

  it('schemaChecksum is stable across key order', () => {
    const a = schemaChecksum({ a: 1, b: 2 });
    const b = schemaChecksum({ b: 2, a: 1 });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Dispatcher (tenant enforcement — CRITICAL)
// ---------------------------------------------------------------------------

function makeRegistration(secret: string): EntityHandlerRegistration {
  return {
    verifier: new SharedSecretVerifier(secret),
    entities: {
      'org.period@v1': {
        list: async ({ tenantId }) => [{ id: 'p1', tenantId, name: 'Q1' }],
        getById: async ({ tenantId, id }) => ({ id, tenantId, name: 'lookup' }),
      },
    },
  };
}

function signTestJwt(
  secret: string,
  claims: Partial<ScopedTokenClaims>,
): string {
  return jwt.sign(
    {
      iss: 'anby-registry',
      sub: 'com.test.consumer',
      tenantId: 'T1',
      scope: 'entity.read',
      jti: 'test',
      ...claims,
    },
    secret,
    { algorithm: 'HS256' },
  );
}

describe('entity handler dispatch', () => {
  const SECRET = 'test-secret';

  it('rejects requests with no Bearer token (CRITICAL)', async () => {
    const r = makeRegistration(SECRET);
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/',
      searchParams: new URLSearchParams(),
      headers: {},
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with HMAC + x-tenant-id legacy headers (CRITICAL)', async () => {
    const r = makeRegistration(SECRET);
    const token = signTestJwt(SECRET, { tenantId: 'T1' });
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/',
      searchParams: new URLSearchParams(),
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': 'T2', // attempt to override
        'x-internal-user': 'attacker',
      },
    });
    expect(res.status).toBe(401);
  });

  it('rejects invalid JWT signature (CRITICAL)', async () => {
    const r = makeRegistration(SECRET);
    const badToken = jwt.sign(
      { iss: 'anby-registry', sub: 'x', tenantId: 'T1', scope: 'entity.read' },
      'wrong-secret',
      { algorithm: 'HS256' },
    );
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/',
      searchParams: new URLSearchParams(),
      headers: { authorization: `Bearer ${badToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects JWT with missing tenantId claim (CRITICAL — no default bleed)', async () => {
    const r = makeRegistration(SECRET);
    const token = jwt.sign(
      { iss: 'anby-registry', sub: 'x', scope: 'entity.read' },
      SECRET,
      { algorithm: 'HS256' },
    );
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/',
      searchParams: new URLSearchParams(),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it('passes tenantId from JWT claim to handler (CRITICAL)', async () => {
    const r = makeRegistration(SECRET);
    const token = signTestJwt(SECRET, { tenantId: 'T1', sub: 'com.test.okr' });
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/',
      searchParams: new URLSearchParams(),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as Array<{ tenantId: string }>;
    expect(body[0].tenantId).toBe('T1');
  });

  it('different JWT tenant → different data (tenant isolation)', async () => {
    const r = makeRegistration(SECRET);
    const tokenT1 = signTestJwt(SECRET, { tenantId: 'T1' });
    const tokenT2 = signTestJwt(SECRET, { tenantId: 'T2' });
    const res1 = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/',
      searchParams: new URLSearchParams(),
      headers: { authorization: `Bearer ${tokenT1}` },
    });
    const res2 = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/',
      searchParams: new URLSearchParams(),
      headers: { authorization: `Bearer ${tokenT2}` },
    });
    expect((res1.body as Array<{ tenantId: string }>)[0].tenantId).toBe('T1');
    expect((res2.body as Array<{ tenantId: string }>)[0].tenantId).toBe('T2');
  });

  it('ready probe bypasses auth', async () => {
    const r = makeRegistration(SECRET);
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/ready',
      searchParams: new URLSearchParams(),
      headers: {},
    });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('ready');
  });

  it('health endpoint bypasses auth', async () => {
    const r = makeRegistration(SECRET);
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/health',
      searchParams: new URLSearchParams(),
      headers: {},
    });
    expect(res.status).toBe(200);
  });

  it('unknown entity returns 404', async () => {
    const r = makeRegistration(SECRET);
    const token = signTestJwt(SECRET, { tenantId: 'T1' });
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/unknown.entity/v1/',
      searchParams: new URLSearchParams(),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it('getById route returns handler response', async () => {
    const r = makeRegistration(SECRET);
    const token = signTestJwt(SECRET, { tenantId: 'T1' });
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/abc',
      searchParams: new URLSearchParams(),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { id: string; tenantId: string };
    expect(body.id).toBe('abc');
    expect(body.tenantId).toBe('T1');
  });

  // CR-9 defense-in-depth CIDR allowlist.
  it('rejects request from IP outside allowedCidrs (CRITICAL)', async () => {
    const r: EntityHandlerRegistration = {
      ...makeRegistration(SECRET),
      allowedCidrs: ['10.0.0.0/8'],
    };
    const token = signTestJwt(SECRET, { tenantId: 'T1' });
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/',
      searchParams: new URLSearchParams(),
      headers: {
        authorization: `Bearer ${token}`,
        'x-forwarded-for': '203.0.113.5', // public IP
      },
    });
    expect(res.status).toBe(404);
  });

  it('accepts request from IP inside allowedCidrs', async () => {
    const r: EntityHandlerRegistration = {
      ...makeRegistration(SECRET),
      allowedCidrs: ['10.0.0.0/8'],
    };
    const token = signTestJwt(SECRET, { tenantId: 'T1' });
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/',
      searchParams: new URLSearchParams(),
      headers: {
        authorization: `Bearer ${token}`,
        'x-forwarded-for': '10.0.1.5',
      },
    });
    expect(res.status).toBe(200);
  });

  it('falls back to remoteAddress when X-Forwarded-For is absent', async () => {
    const r: EntityHandlerRegistration = {
      ...makeRegistration(SECRET),
      allowedCidrs: ['10.0.0.0/8'],
    };
    const token = signTestJwt(SECRET, { tenantId: 'T1' });
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/',
      searchParams: new URLSearchParams(),
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: '10.0.2.9',
    });
    expect(res.status).toBe(200);
  });

  it('normalizes IPv6-mapped IPv4 addresses', async () => {
    const r: EntityHandlerRegistration = {
      ...makeRegistration(SECRET),
      allowedCidrs: ['10.0.0.0/8'],
    };
    const token = signTestJwt(SECRET, { tenantId: 'T1' });
    const res = await dispatchEntityRequest(r, {
      method: 'GET',
      pathname: '/_anby/entities/org.period/v1/',
      searchParams: new URLSearchParams(),
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: '::ffff:10.0.1.5',
    });
    expect(res.status).toBe(200);
  });
});
