import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';

import { MultiIssuerVerifier, RegistryPublicKeyVerifier } from './handler.js';
import { createAppVerifier } from './create-verifier.js';
import { signServiceToken } from '../services/sign.js';
import {
  bootstrapFromToken,
  _resetBootstrapForTests,
  ANBY_TOKEN_PREFIX,
} from '../bootstrap/index.js';
import {
  configureAppIdentity,
  _resetAppIdentity,
  generateAppKeyPair,
} from './identity.js';

const REGISTRY_ISSUER = 'anby-registry';
const SERVICE_APP_ID = 'vn.bravebits.god-brain';

function makeFetch(routes: Record<string, () => unknown>): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = new URL(url).pathname;
    const handler = routes[path];
    if (!handler) {
      return new Response(`no route: ${path}`, { status: 404 });
    }
    const body = handler();
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('MultiIssuerVerifier', () => {
  let registryKey: { publicKeyPem: string; privateKeyPem: string };
  let serviceKey: { publicKeyPem: string; privateKeyPem: string };

  beforeEach(() => {
    registryKey = generateAppKeyPair();
    serviceKey = generateAppKeyPair();
  });

  function fetchWithBothKeys(): typeof fetch {
    return makeFetch({
      '/registry/entity-token/public-key': () => ({
        publicKey: registryKey.publicKeyPem,
        algo: 'EdDSA',
      }),
      [`/registry/services/${SERVICE_APP_ID}/public-key`]: () => ({
        publicKey: serviceKey.publicKeyPem,
        algo: 'EdDSA',
      }),
    });
  }

  function signEdDSA(privateKeyPem: string, payload: object): string {
    const header = { alg: 'EdDSA', typ: 'JWT' };
    const h64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign(
      null,
      Buffer.from(`${h64}.${p64}`),
      crypto.createPrivateKey(privateKeyPem),
    );
    return `${h64}.${p64}.${sig.toString('base64url')}`;
  }

  it('throws if constructed with empty acceptIssuers', () => {
    expect(
      () => new MultiIssuerVerifier('http://reg', [], fetchWithBothKeys()),
    ).toThrow(/at least one acceptIssuer/);
  });

  it('throws on verify before init', () => {
    const v = new MultiIssuerVerifier(
      'http://reg',
      [REGISTRY_ISSUER],
      fetchWithBothKeys(),
    );
    expect(() => v.verify('x.y.z')).toThrow(/not initialized/);
  });

  it('accepts token signed by registry-issuer key', async () => {
    const v = new MultiIssuerVerifier(
      'http://reg',
      [REGISTRY_ISSUER],
      fetchWithBothKeys(),
    );
    await v.init();
    const now = Math.floor(Date.now() / 1000);
    const token = signEdDSA(registryKey.privateKeyPem, {
      iss: REGISTRY_ISSUER,
      sub: 'caller-app',
      tenantId: 'T1',
      scope: 'entity.read',
      iat: now,
      exp: now + 60,
      jti: 'a',
    });
    const claims = v.verify(token);
    expect(claims.iss).toBe(REGISTRY_ISSUER);
    expect(claims.tenantId).toBe('T1');
  });

  it('accepts token self-signed by service-app issuer', async () => {
    const v = new MultiIssuerVerifier(
      'http://reg',
      [REGISTRY_ISSUER, SERVICE_APP_ID],
      fetchWithBothKeys(),
    );
    await v.init();
    const now = Math.floor(Date.now() / 1000);
    const token = signEdDSA(serviceKey.privateKeyPem, {
      iss: SERVICE_APP_ID,
      sub: SERVICE_APP_ID,
      tenantId: 'default',
      scope: 'god-brain.feed',
      iat: now,
      exp: now + 60,
      jti: 'b',
    });
    const claims = v.verify(token);
    expect(claims.iss).toBe(SERVICE_APP_ID);
    expect(claims.scope).toBe('god-brain.feed');
  });

  it('rejects token with iss not in allowlist', async () => {
    const v = new MultiIssuerVerifier(
      'http://reg',
      [REGISTRY_ISSUER],
      fetchWithBothKeys(),
    );
    await v.init();
    const now = Math.floor(Date.now() / 1000);
    const token = signEdDSA(serviceKey.privateKeyPem, {
      iss: SERVICE_APP_ID,
      sub: SERVICE_APP_ID,
      tenantId: 'default',
      scope: 'god-brain.feed',
      iat: now,
      exp: now + 60,
      jti: 'c',
    });
    expect(() => v.verify(token)).toThrow(/invalid issuer/);
  });

  it('rejects token whose signature does not match the issuer key', async () => {
    const v = new MultiIssuerVerifier(
      'http://reg',
      [REGISTRY_ISSUER, SERVICE_APP_ID],
      fetchWithBothKeys(),
    );
    await v.init();
    const now = Math.floor(Date.now() / 1000);
    // Sign with registryKey but claim iss=SERVICE_APP_ID — should fail
    // because verifier looks up SERVICE_APP_ID's key and signature won't match.
    const token = signEdDSA(registryKey.privateKeyPem, {
      iss: SERVICE_APP_ID,
      sub: SERVICE_APP_ID,
      tenantId: 'default',
      scope: 'god-brain.feed',
      iat: now,
      exp: now + 60,
      jti: 'd',
    });
    expect(() => v.verify(token)).toThrow(/signature verification failed/);
  });

  it('rejects expired token', async () => {
    const v = new MultiIssuerVerifier(
      'http://reg',
      [SERVICE_APP_ID],
      fetchWithBothKeys(),
    );
    await v.init();
    const now = Math.floor(Date.now() / 1000);
    const token = signEdDSA(serviceKey.privateKeyPem, {
      iss: SERVICE_APP_ID,
      sub: SERVICE_APP_ID,
      tenantId: 'default',
      scope: 'god-brain.feed',
      iat: now - 120,
      exp: now - 60,
      jti: 'e',
    });
    expect(() => v.verify(token)).toThrow(/expired/);
  });

  it('rejects token missing iss claim', async () => {
    const v = new MultiIssuerVerifier(
      'http://reg',
      [REGISTRY_ISSUER],
      fetchWithBothKeys(),
    );
    await v.init();
    const now = Math.floor(Date.now() / 1000);
    const token = signEdDSA(registryKey.privateKeyPem, {
      sub: 'x',
      tenantId: 'T1',
      scope: 'entity.read',
      iat: now,
      exp: now + 60,
      jti: 'f',
    });
    expect(() => v.verify(token)).toThrow(/missing issuer/);
  });

  it('init throws if registry key fetch fails', async () => {
    const fetch404: typeof fetch = (async () =>
      new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const v = new MultiIssuerVerifier(
      'http://reg',
      [REGISTRY_ISSUER],
      fetch404,
    );
    await expect(v.init()).rejects.toThrow(/unable to fetch registry token public key/);
  });

  it('init throws if service public key fetch fails', async () => {
    const fetchOnlyRegistry = makeFetch({
      '/registry/entity-token/public-key': () => ({
        publicKey: registryKey.publicKeyPem,
        algo: 'EdDSA',
      }),
      // no service route
    });
    const v = new MultiIssuerVerifier(
      'http://reg',
      [REGISTRY_ISSUER, SERVICE_APP_ID],
      fetchOnlyRegistry,
    );
    await expect(v.init()).rejects.toThrow(
      /unable to fetch service public key for vn\.bravebits\.god-brain/,
    );
  });
});

describe('RegistryPublicKeyVerifier (back-compat after refactor)', () => {
  it('still accepts registry-issued EdDSA tokens', async () => {
    const key = generateAppKeyPair();
    const fetchImpl = makeFetch({
      '/registry/entity-token/public-key': () => ({
        publicKey: key.publicKeyPem,
        algo: 'EdDSA',
      }),
    });
    const v = new RegistryPublicKeyVerifier('http://reg', fetchImpl);
    await v.init();
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'EdDSA', typ: 'JWT' };
    const payload = {
      iss: 'anby-registry',
      sub: 'consumer',
      tenantId: 'T1',
      scope: 'entity.read',
      iat: now,
      exp: now + 60,
      jti: 'rg',
    };
    const h64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign(
      null,
      Buffer.from(`${h64}.${p64}`),
      crypto.createPrivateKey(key.privateKeyPem),
    );
    const token = `${h64}.${p64}.${sig.toString('base64url')}`;
    expect(v.verify(token).tenantId).toBe('T1');
  });

  it('rejects tokens claiming a non-registry iss', async () => {
    const key = generateAppKeyPair();
    const fetchImpl = makeFetch({
      '/registry/entity-token/public-key': () => ({
        publicKey: key.publicKeyPem,
        algo: 'EdDSA',
      }),
    });
    const v = new RegistryPublicKeyVerifier('http://reg', fetchImpl);
    await v.init();
    const now = Math.floor(Date.now() / 1000);
    const h64 = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString(
      'base64url',
    );
    const p64 = Buffer.from(
      JSON.stringify({
        iss: 'someone-else',
        sub: 'x',
        tenantId: 'T1',
        scope: 'entity.read',
        iat: now,
        exp: now + 60,
        jti: 'wrong',
      }),
    ).toString('base64url');
    const sig = crypto.sign(
      null,
      Buffer.from(`${h64}.${p64}`),
      crypto.createPrivateKey(key.privateKeyPem),
    );
    expect(() => v.verify(`${h64}.${p64}.${sig.toString('base64url')}`)).toThrow(
      /invalid issuer/,
    );
  });
});

// ---------------------------------------------------------------------------
// signServiceToken (caller side, e.g. god-brain → app feed)
// ---------------------------------------------------------------------------

describe('signServiceToken', () => {
  beforeEach(() => {
    _resetAppIdentity();
  });

  it('signs JWT with iss=sub=appId, scope, tenantId, exp~60s', () => {
    const key = generateAppKeyPair();
    const token = signServiceToken({
      identity: { appId: SERVICE_APP_ID, privateKeyPem: key.privateKeyPem },
      scope: 'god-brain.feed',
      tenantId: 'default',
    });
    const [h64, p64] = token.split('.');
    const header = JSON.parse(Buffer.from(h64, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
    expect(header.alg).toBe('EdDSA');
    expect(payload.iss).toBe(SERVICE_APP_ID);
    expect(payload.sub).toBe(SERVICE_APP_ID);
    expect(payload.scope).toBe('god-brain.feed');
    expect(payload.tenantId).toBe('default');
    expect(payload.exp - payload.iat).toBe(60);
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('signed token verifies via MultiIssuerVerifier round-trip', async () => {
    const key = generateAppKeyPair();
    const token = signServiceToken({
      identity: { appId: SERVICE_APP_ID, privateKeyPem: key.privateKeyPem },
      scope: 'god-brain.feed',
      tenantId: 'tenant-X',
      ttlSeconds: 30,
    });
    const fetchImpl = makeFetch({
      [`/registry/services/${SERVICE_APP_ID}/public-key`]: () => ({
        publicKey: key.publicKeyPem,
        algo: 'EdDSA',
      }),
    });
    const v = new MultiIssuerVerifier(
      'http://reg',
      [SERVICE_APP_ID],
      fetchImpl,
    );
    await v.init();
    const claims = v.verify(token);
    expect(claims.iss).toBe(SERVICE_APP_ID);
    expect(claims.scope).toBe('god-brain.feed');
    expect(claims.tenantId).toBe('tenant-X');
  });

  it('uses configured app identity by default', () => {
    const key = generateAppKeyPair();
    configureAppIdentity({
      appId: SERVICE_APP_ID,
      privateKeyPem: key.privateKeyPem,
    });
    const token = signServiceToken({
      scope: 'god-brain.feed',
      tenantId: 'default',
    });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    );
    expect(payload.iss).toBe(SERVICE_APP_ID);
  });

  it('honors custom ttlSeconds', () => {
    const key = generateAppKeyPair();
    const fixedNow = new Date('2026-04-23T00:00:00Z');
    const token = signServiceToken({
      identity: { appId: 'svc', privateKeyPem: key.privateKeyPem },
      scope: 's',
      tenantId: 't',
      ttlSeconds: 300,
      now: () => fixedNow,
    });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    );
    expect(payload.exp - payload.iat).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// createAppVerifier — app-side factory using bootstrap state
// ---------------------------------------------------------------------------

describe('createAppVerifier', () => {
  beforeEach(() => {
    _resetBootstrapForTests();
    _resetAppIdentity();
  });

  afterEach(() => {
    _resetBootstrapForTests();
    _resetAppIdentity();
  });

  it('uses bootstrap-discovered registry URL when registryUrl not passed', async () => {
    const appKey = generateAppKeyPair();
    const registryKey = generateAppKeyPair();
    const platformUrl = 'http://platform.test';

    const tokenPayload = {
      v: 1,
      appId: 'com.test.consumer',
      platformUrl,
      privateKey: appKey.privateKeyPem,
    };
    const tokenB64 = Buffer.from(JSON.stringify(tokenPayload)).toString(
      'base64url',
    );
    const appToken = `${ANBY_TOKEN_PREFIX}${tokenB64}`;

    const fetchImpl = makeFetch({
      '/registry/discovery': () => ({
        v: 1,
        endpoints: {
          registryUrl: `${platformUrl}/registry`,
          registryBaseUrl: platformUrl,
          authPublicKeyUrl: `${platformUrl}/auth/public-key`,
        },
        cacheTtlSeconds: 3600,
      }),
      '/auth/public-key': () =>
        // bootstrap fetches as text; makeFetch returns JSON, so override
        registryKey.publicKeyPem,
      '/registry/entity-token/public-key': () => ({
        publicKey: registryKey.publicKeyPem,
        algo: 'EdDSA',
      }),
    });

    // The auth-public-key endpoint expects text/plain. Wrap to return raw
    // PEM for that path.
    const wrappedFetch: typeof fetch = (async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/public-key')) {
        return new Response(registryKey.publicKeyPem, { status: 200 });
      }
      return fetchImpl(input as RequestInfo);
    }) as unknown as typeof fetch;

    await bootstrapFromToken({
      appToken,
      fetchImpl: wrappedFetch,
      cacheDir: `/tmp/anby-test-cache-${Date.now()}`,
    });

    const verifier = await createAppVerifier({ fetchImpl: wrappedFetch });
    expect(verifier).toBeDefined();
    // verifier.verify roundtrip with a registry-issued token
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'EdDSA', typ: 'JWT' };
    const payload = {
      iss: 'anby-registry',
      sub: 'svc',
      tenantId: 'T1',
      scope: 'entity.read',
      iat: now,
      exp: now + 60,
      jti: 'cv',
    };
    const h64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign(
      null,
      Buffer.from(`${h64}.${p64}`),
      crypto.createPrivateKey(registryKey.privateKeyPem),
    );
    const token = `${h64}.${p64}.${sig.toString('base64url')}`;
    expect(verifier.verify(token).tenantId).toBe('T1');
  });

  it('throws helpful error when bootstrap not started', async () => {
    await expect(createAppVerifier()).rejects.toThrow(
      /bootstrap not started|registry URL unavailable/,
    );
  });

  it('uses explicit registryUrl when passed (no bootstrap needed)', async () => {
    const key = generateAppKeyPair();
    const fetchImpl = makeFetch({
      '/registry/entity-token/public-key': () => ({
        publicKey: key.publicKeyPem,
        algo: 'EdDSA',
      }),
    });
    const v = await createAppVerifier({
      registryUrl: 'http://reg',
      fetchImpl,
    });
    expect(v).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Bootstrap deprecation warning (INTERNAL_API_SECRET in app env)
// ---------------------------------------------------------------------------

describe('bootstrap warns on legacy INTERNAL_API_SECRET env', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    _resetBootstrapForTests();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    _resetBootstrapForTests();
    process.env = OLD_ENV;
  });

  it('logs deprecation warning when INTERNAL_API_SECRET is set', async () => {
    process.env.INTERNAL_API_SECRET = 'legacy-value';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const appKey = generateAppKeyPair();
    const registryKey = generateAppKeyPair();
    const platformUrl = 'http://platform.test';
    const tokenPayload = {
      v: 1,
      appId: 'com.test.app',
      platformUrl,
      privateKey: appKey.privateKeyPem,
    };
    const appToken = `${ANBY_TOKEN_PREFIX}${Buffer.from(
      JSON.stringify(tokenPayload),
    ).toString('base64url')}`;

    const fetchImpl: typeof fetch = (async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/registry/discovery')) {
        return new Response(
          JSON.stringify({
            v: 1,
            endpoints: {
              registryUrl: `${platformUrl}/registry`,
              registryBaseUrl: platformUrl,
              authPublicKeyUrl: `${platformUrl}/auth/public-key`,
            },
            cacheTtlSeconds: 3600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/auth/public-key')) {
        return new Response(registryKey.publicKeyPem, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    await bootstrapFromToken({
      appToken,
      fetchImpl,
      cacheDir: `/tmp/anby-test-cache-warn-${Date.now()}`,
    });

    expect(warnSpy).toHaveBeenCalled();
    const allCalls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      allCalls.some((m) => m.includes('INTERNAL_API_SECRET') && m.includes('no longer used')),
    ).toBe(true);

    warnSpy.mockRestore();
  });

  it('does NOT warn when INTERNAL_API_SECRET is absent', async () => {
    delete process.env.INTERNAL_API_SECRET;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const appKey = generateAppKeyPair();
    const registryKey = generateAppKeyPair();
    const platformUrl = 'http://platform.test';
    const tokenPayload = {
      v: 1,
      appId: 'com.test.app2',
      platformUrl,
      privateKey: appKey.privateKeyPem,
    };
    const appToken = `${ANBY_TOKEN_PREFIX}${Buffer.from(
      JSON.stringify(tokenPayload),
    ).toString('base64url')}`;

    const fetchImpl: typeof fetch = (async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/registry/discovery')) {
        return new Response(
          JSON.stringify({
            v: 1,
            endpoints: {
              registryUrl: `${platformUrl}/registry`,
              registryBaseUrl: platformUrl,
              authPublicKeyUrl: `${platformUrl}/auth/public-key`,
            },
            cacheTtlSeconds: 3600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/auth/public-key')) {
        return new Response(registryKey.publicKeyPem, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    await bootstrapFromToken({
      appToken,
      fetchImpl,
      cacheDir: `/tmp/anby-test-cache-noenv-${Date.now()}`,
    });

    const internalApiCalls = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes('INTERNAL_API_SECRET'),
    );
    expect(internalApiCalls).toHaveLength(0);

    warnSpy.mockRestore();
  });
});
