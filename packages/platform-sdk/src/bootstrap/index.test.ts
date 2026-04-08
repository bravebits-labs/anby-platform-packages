import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import {
  bootstrapFromToken,
  parseAppToken,
  ANBY_TOKEN_PREFIX,
  _resetBootstrapForTests,
} from './index.js';
import type { DiscoveryResponse } from './types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Generate one Ed25519 keypair for the per-app identity
const { privateKey: appPrivKey } = generateKeyPairSync('ed25519');
const appPrivKeyPem = appPrivKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();

// Generate one RSA keypair for the auth-service public key
const { privateKey: rsaPriv, publicKey: rsaPub } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const rsaPubPem = rsaPub.export({ type: 'spki', format: 'pem' }).toString();

function makeToken(overrides: Record<string, unknown> = {}): string {
  const payload = {
    v: 1,
    appId: 'com.test.example',
    platformUrl: 'https://anby.test',
    privateKey: appPrivKeyPem,
    ...overrides,
  };
  return ANBY_TOKEN_PREFIX + Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function makeDiscovery(): DiscoveryResponse {
  return {
    v: 1,
    platform: { name: 'anby', version: '0.4.0' },
    endpoints: {
      authPublicKeyUrl: 'https://anby.test/auth/public-key',
      scopedTokenUrl: 'https://anby.test/registry/scoped-token',
      entityTokenPublicKeyUrl: 'https://anby.test/registry/entity-token/public-key',
      gatewayUrl: 'https://anby.test',
      registryUrl: 'https://anby.test/registry',
      tenantServiceUrl: 'https://anby.test/tenants',
      eventRouterUrl: 'https://anby.test/events',
    },
    cacheTtlSeconds: 86400,
  };
}

function makeFetch(opts: {
  discovery?: DiscoveryResponse;
  authPublicKey?: string;
  fail?: 'discovery' | 'public-key' | 'all';
}): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (opts.fail === 'all') {
      throw new Error('network error');
    }
    if (u.includes('/registry/discovery')) {
      if (opts.fail === 'discovery') throw new Error('discovery down');
      return new Response(JSON.stringify(opts.discovery ?? makeDiscovery()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.includes('/auth/public-key')) {
      if (opts.fail === 'public-key') throw new Error('auth down');
      return new Response(opts.authPublicKey ?? rsaPubPem, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseAppToken', () => {
  it('parses a valid token', () => {
    const tok = parseAppToken(makeToken());
    expect(tok.appId).toBe('com.test.example');
    expect(tok.platformUrl).toBe('https://anby.test');
    expect(tok.privateKey).toContain('PRIVATE KEY');
  });

  it('strips trailing slash from platformUrl', () => {
    const tok = parseAppToken(makeToken({ platformUrl: 'https://anby.test/' }));
    expect(tok.platformUrl).toBe('https://anby.test');
  });

  it('rejects empty token', () => {
    expect(() => parseAppToken('')).toThrow();
  });

  it('rejects token without anby_v1_ prefix', () => {
    expect(() => parseAppToken('garbage')).toThrow(/anby_v1_/);
  });

  it('rejects token with invalid base64', () => {
    expect(() => parseAppToken('anby_v1_!!!not-base64!!!')).toThrow();
  });

  it('rejects token with malformed JSON', () => {
    const bad = ANBY_TOKEN_PREFIX + Buffer.from('not json').toString('base64url');
    expect(() => parseAppToken(bad)).toThrow();
  });

  it('rejects token missing required fields', () => {
    const bad = ANBY_TOKEN_PREFIX + Buffer.from(JSON.stringify({ v: 1 })).toString('base64url');
    expect(() => parseAppToken(bad)).toThrow(/required fields/);
  });

  it('rejects token with private key that is not PEM', () => {
    const bad = ANBY_TOKEN_PREFIX + Buffer.from(JSON.stringify({
      v: 1,
      appId: 'x',
      platformUrl: 'https://x',
      privateKey: 'not a pem',
    })).toString('base64url');
    expect(() => parseAppToken(bad)).toThrow(/not a PEM/);
  });

  it('rejects token with wrong version', () => {
    const bad = ANBY_TOKEN_PREFIX + Buffer.from(JSON.stringify({
      v: 2,
      appId: 'x',
      platformUrl: 'https://x',
      privateKey: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
    })).toString('base64url');
    expect(() => parseAppToken(bad)).toThrow(/required fields/);
  });
});

describe('bootstrapFromToken — happy path', () => {
  let cacheDir: string;

  beforeEach(() => {
    _resetBootstrapForTests();
    cacheDir = mkdtempSync(join(tmpdir(), 'anby-bootstrap-'));
  });
  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('fetches discovery + auth public key, configures SDK', async () => {
    await bootstrapFromToken({
      appToken: makeToken(),
      cacheDir,
      fetchImpl: makeFetch({}),
    });
    // Confirm cache file written
    const fs = await import('node:fs/promises');
    const files = await fs.readdir(cacheDir);
    expect(files.some((f) => f.startsWith('bootstrap-'))).toBe(true);
  });

  it('writes a cache entry that contains discovery + public key but no private key', async () => {
    await bootstrapFromToken({
      appToken: makeToken(),
      cacheDir,
      fetchImpl: makeFetch({}),
    });
    const fs = await import('node:fs/promises');
    const files = await fs.readdir(cacheDir);
    const cacheFile = files.find((f) => f.startsWith('bootstrap-'))!;
    const raw = await fs.readFile(join(cacheDir, cacheFile), 'utf-8');
    const cache = JSON.parse(raw);
    expect(cache.discovery.v).toBe(1);
    expect(cache.authPublicKeyPem).toContain('BEGIN PUBLIC KEY');
    // CRITICAL: cache must NOT contain the private key
    expect(JSON.stringify(cache)).not.toContain('PRIVATE KEY');
  });
});

describe('bootstrapFromToken — offline cold start', () => {
  let cacheDir: string;

  beforeEach(() => {
    _resetBootstrapForTests();
    cacheDir = mkdtempSync(join(tmpdir(), 'anby-bootstrap-'));
  });
  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('falls back to disk cache when discovery fetch fails and cache exists', async () => {
    // Warm the cache with one successful bootstrap
    await bootstrapFromToken({
      appToken: makeToken(),
      cacheDir,
      fetchImpl: makeFetch({}),
    });

    // Now bootstrap with all fetches failing — should use cache
    await expect(
      bootstrapFromToken({
        appToken: makeToken(),
        cacheDir,
        fetchImpl: makeFetch({ fail: 'all' }),
      }),
    ).resolves.not.toThrow();
  });

  it('throws when discovery fails and no cache exists', async () => {
    await expect(
      bootstrapFromToken({
        appToken: makeToken(),
        cacheDir,
        fetchImpl: makeFetch({ fail: 'all' }),
      }),
    ).rejects.toThrow(/no cache available/);
  });
});

describe('bootstrapFromToken — error cases', () => {
  let cacheDir: string;

  beforeEach(() => {
    _resetBootstrapForTests();
    cacheDir = mkdtempSync(join(tmpdir(), 'anby-bootstrap-'));
  });
  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('CRITICAL: rejects auth-public-key endpoint that returns PRIVATE KEY material', async () => {
    const fetchImpl = makeFetch({
      authPublicKey: '-----BEGIN PRIVATE KEY-----\nLEAK\n-----END PRIVATE KEY-----',
    });
    await expect(
      bootstrapFromToken({
        appToken: makeToken(),
        cacheDir,
        fetchImpl,
      }),
    ).rejects.toThrow(/PRIVATE KEY/);
  });

  it('rejects auth-public-key endpoint that returns non-PEM content', async () => {
    const fetchImpl = makeFetch({ authPublicKey: 'not a pem' });
    await expect(
      bootstrapFromToken({
        appToken: makeToken(),
        cacheDir,
        fetchImpl,
      }),
    ).rejects.toThrow(/not a PEM/);
  });

  it('throws on malformed token before any network call', async () => {
    let fetchCalled = false;
    const fetchImpl = (async () => {
      fetchCalled = true;
      return new Response('', { status: 200 });
    }) as typeof fetch;
    await expect(
      bootstrapFromToken({
        appToken: 'garbage',
        cacheDir,
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(fetchCalled).toBe(false);
  });
});
