import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  configureAuth,
  verifyUserJwt,
  verifyInternalJwt,
  verifyHmac,
  signHmac,
  authenticateRequest,
  JWT_ISSUER,
  JWT_AUDIENCE,
  TYP_USER,
  TYP_INTERNAL,
  TYP_OAUTH_STATE,
} from './index.js';

// Generate a single test keypair shared across all tests in this file.
// ~50ms one-time cost.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const HMAC_SECRET = 'test-hmac-secret';

function signRS256User(claims: Record<string, unknown> = {}): string {
  return jwt.sign(
    { sub: 'user-1', email: 'u@bravebits.vn', tenantId: 't1', typ: TYP_USER, ...claims },
    privateKeyPem,
    { algorithm: 'RS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: '1h' },
  );
}

function signRS256Internal(): string {
  return jwt.sign(
    { sub: 'user-1', email: 'u@bravebits.vn', typ: TYP_INTERNAL },
    privateKeyPem,
    { algorithm: 'RS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: '1h' },
  );
}

function signRS256OAuthState(): string {
  return jwt.sign(
    { returnUrl: '/dashboard', nonce: 'test-nonce', typ: TYP_OAUTH_STATE },
    privateKeyPem,
    { algorithm: 'RS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: '5m' },
  );
}

describe('configureAuth', () => {
  it('rejects empty config', () => {
    expect(() => configureAuth({})).toThrow();
  });

  it('accepts hmacSecret only (registry use case)', () => {
    configureAuth({ hmacSecret: HMAC_SECRET });
    const sig = signHmac('alice@bravebits.vn');
    expect(verifyHmac('alice@bravebits.vn', sig)).toBe(true);
  });

  it('accepts jwtPublicKey only (read-only consumer use case)', () => {
    configureAuth({ jwtPublicKey: publicKeyPem });
    expect(() => verifyUserJwt(signRS256User())).not.toThrow();
  });
});

describe('verifyUserJwt — RS256 path', () => {
  beforeEach(() => {
    configureAuth({
      jwtPublicKey: publicKeyPem,
      hmacSecret: HMAC_SECRET,
    });
  });

  it('accepts a valid RS256 user token', () => {
    const user = verifyUserJwt(signRS256User());
    expect(user.id).toBe('user-1');
    expect(user.email).toBe('u@bravebits.vn');
    expect(user.tenantId).toBe('t1');
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign(
      { sub: 'u', email: 'u@x.com', typ: TYP_USER },
      privateKeyPem,
      { algorithm: 'RS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: '-1h' },
    );
    expect(() => verifyUserJwt(expired)).toThrow();
  });

  it('rejects a token signed with a different key', () => {
    const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const evil = jwt.sign(
      { sub: 'u', email: 'u@x.com', typ: TYP_USER },
      otherKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      { algorithm: 'RS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: '1h' },
    );
    expect(() => verifyUserJwt(evil)).toThrow();
  });

  it('rejects a token with wrong issuer', () => {
    const evil = jwt.sign(
      { sub: 'u', email: 'u@x.com', typ: TYP_USER },
      privateKeyPem,
      { algorithm: 'RS256', issuer: 'evil', audience: JWT_AUDIENCE, expiresIn: '1h' },
    );
    expect(() => verifyUserJwt(evil)).toThrow();
  });

  it('rejects a token with wrong audience', () => {
    const evil = jwt.sign(
      { sub: 'u', email: 'u@x.com', typ: TYP_USER },
      privateKeyPem,
      { algorithm: 'RS256', issuer: JWT_ISSUER, audience: 'evil', expiresIn: '1h' },
    );
    expect(() => verifyUserJwt(evil)).toThrow();
  });
});

describe('CRITICAL: cross-token confusion', () => {
  beforeEach(() => {
    configureAuth({
      jwtPublicKey: publicKeyPem,
      hmacSecret: HMAC_SECRET,
    });
  });

  it('verifyUserJwt MUST reject an internal JWT', () => {
    expect(() => verifyUserJwt(signRS256Internal())).toThrow();
  });

  it('verifyUserJwt MUST reject an OAuth state token', () => {
    expect(() => verifyUserJwt(signRS256OAuthState())).toThrow();
  });

  it('verifyInternalJwt MUST reject a user JWT', () => {
    expect(() => verifyInternalJwt(signRS256User())).toThrow();
  });

  it('verifyInternalJwt MUST reject an OAuth state token', () => {
    expect(() => verifyInternalJwt(signRS256OAuthState())).toThrow();
  });

});

describe('CRITICAL: algorithm confusion', () => {
  beforeEach(() => {
    configureAuth({
      jwtPublicKey: publicKeyPem,
      hmacSecret: HMAC_SECRET,
    });
  });

  it('rejects alg:none tokens', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'attacker',
        email: 'a@evil.com',
        typ: TYP_USER,
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    expect(() => verifyUserJwt(`${header}.${payload}.`)).toThrow();
  });

  it('rejects HS256 tokens signed with the public key as the secret (alg confusion)', () => {
    const evil = jwt.sign(
      { sub: 'attacker', email: 'a@evil.com', typ: TYP_USER },
      publicKeyPem,
      { algorithm: 'HS256', expiresIn: '1h' },
    );
    expect(() => verifyUserJwt(evil)).toThrow();
  });
});

// PR4: dual-verify and HS256-only mode tests removed alongside the fallback paths.
// SDK is RS256-only post-PR4. The verifyUserJwt — RS256 path tests above cover
// the canonical happy path and edge cases.

describe('HMAC service-to-service (regression)', () => {
  beforeEach(() => {
    configureAuth({
      jwtPublicKey: publicKeyPem,
      hmacSecret: HMAC_SECRET,
    });
  });

  it('signHmac and verifyHmac round-trip', () => {
    const sig = signHmac('alice@bravebits.vn');
    expect(verifyHmac('alice@bravebits.vn', sig)).toBe(true);
  });

  it('verifyHmac rejects tampered user value', () => {
    const sig = signHmac('alice@bravebits.vn');
    expect(verifyHmac('bob@bravebits.vn', sig)).toBe(false);
  });

  it('verifyHmac rejects wrong-length signature without throwing', () => {
    expect(verifyHmac('alice@bravebits.vn', 'short')).toBe(false);
  });
});

describe('authenticateRequest', () => {
  beforeEach(() => {
    configureAuth({
      jwtPublicKey: publicKeyPem,
      hmacSecret: HMAC_SECRET,
    });
  });

  function makeRequest(headers: Record<string, string>): Request {
    return new Request('http://localhost/test', { headers });
  }

  it('authenticates RS256 Bearer token', () => {
    const req = makeRequest({ authorization: `Bearer ${signRS256User()}` });
    const user = authenticateRequest(req);
    expect(user?.id).toBe('user-1');
  });

  it('authenticates RS256 cookie token (Remix SSR path)', () => {
    const req = makeRequest({ cookie: `auth-token=${signRS256User()}` });
    const user = authenticateRequest(req);
    expect(user?.id).toBe('user-1');
  });

  it('rejects internal JWT presented as Bearer (cross-token confusion)', () => {
    const req = makeRequest({ authorization: `Bearer ${signRS256Internal()}` });
    expect(authenticateRequest(req)).toBeNull();
  });

  it('authenticates HMAC service-to-service via x-internal-* headers', () => {
    const sig = signHmac('worker@svc');
    const req = makeRequest({
      'x-internal-user': 'worker@svc',
      'x-internal-signature': sig,
    });
    const user = authenticateRequest(req);
    expect(user?.id).toBe('internal');
    expect(user?.email).toBe('worker@svc');
  });

  it('returns null for unauthenticated request', () => {
    expect(authenticateRequest(makeRequest({}))).toBeNull();
  });
});
