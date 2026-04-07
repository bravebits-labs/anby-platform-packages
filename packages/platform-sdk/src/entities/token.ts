/**
 * Scoped service token client (CR-1 + original Issue 1).
 *
 * The caller app asks the registry for a short-lived JWT scoped to a
 * specific (callerAppId, tenantId) pair. Authentication uses per-app
 * Ed25519 signatures — the registry verifies the signature, looks up which
 * app the public key belongs to, and issues a token with that appId baked
 * into the claims. `callerAppId` is NEVER read from the body.
 *
 * Token cache: keyed by (callerAppId, tenantId). Single-inflight dedup
 * prevents stampedes when a burst of requests hits a cold cache.
 */

import type { ScopedToken } from './types.js';
import { ScopedTokenError } from './errors.js';
import { getAppIdentity, signAppRequest } from './identity.js';
import { getPlatformConfig } from '../config/index.js';

interface CacheEntry {
  token: ScopedToken;
}

const _cache = new Map<string, CacheEntry>();
const _inflight = new Map<string, Promise<ScopedToken>>();

function cacheKey(callerAppId: string, tenantId: string): string {
  return `${callerAppId}::${tenantId}`;
}

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function isFresh(token: ScopedToken): boolean {
  // Refresh 30s before real expiry to cover clock skew + network RTT.
  return token.expiresAt - 30 > nowEpoch();
}

export async function getScopedToken(
  tenantId: string,
): Promise<ScopedToken> {
  const identity = getAppIdentity();
  const key = cacheKey(identity.appId, tenantId);

  const cached = _cache.get(key);
  if (cached && isFresh(cached.token)) {
    return cached.token;
  }

  const existing = _inflight.get(key);
  if (existing) return existing;

  const fetchPromise = fetchNewToken(tenantId).finally(() => {
    _inflight.delete(key);
  });
  _inflight.set(key, fetchPromise);
  const token = await fetchPromise;
  _cache.set(key, { token });
  return token;
}

async function fetchNewToken(tenantId: string): Promise<ScopedToken> {
  const identity = getAppIdentity();
  const { registryUrl } = getPlatformConfig();
  const body = JSON.stringify({
    tenantId,
    scope: 'entity.read',
  });
  const headers = signAppRequest({ identity, tenantId, body });
  const res = await fetch(`${registryUrl}/registry/scoped-token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ScopedTokenError(
      `registry rejected scoped token request (${res.status}): ${text}`,
      res.status,
    );
  }
  const json = (await res.json()) as {
    token: string;
    expiresAt: number;
    claims: ScopedToken['claims'];
  };
  return {
    token: json.token,
    expiresAt: json.expiresAt,
    claims: json.claims,
  };
}

export function _clearTokenCache(): void {
  _cache.clear();
  _inflight.clear();
}

/** Force-evict a specific (caller, tenant) pair — used after a 401. */
export function invalidateToken(tenantId: string): void {
  const identity = getAppIdentity();
  _cache.delete(cacheKey(identity.appId, tenantId));
}
