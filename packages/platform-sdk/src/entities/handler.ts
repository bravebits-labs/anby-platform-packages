/**
 * Entity handler — provider side.
 *
 * Builds a Remix/Nest-agnostic request handler that enforces tenant
 * isolation by construction. The ONLY thing userland handlers see is a
 * typed context containing tenantId (from the verified JWT, not any
 * header) — they never touch the raw request. See CR-2 (kill HMAC tenant
 * bypass) and CR-7 (two-phase activation via /_anby/entities/{name}/ready).
 *
 * Routing convention:
 *   GET  /_anby/entities/{name}/{version}/           → list
 *   GET  /_anby/entities/{name}/{version}/{id}       → getById
 *   GET  /_anby/entities/{name}/{version}/ready      → readiness probe
 *   GET  /_anby/health                                → liveness probe
 *
 * Auth: Authorization: Bearer <scoped-jwt>
 *   - Verifies signature against registry public key (fetched once at boot
 *     and cached 24h). Falls back to shared JWT_SECRET only in tests.
 *   - Rejects every other auth method (no HMAC header fallback — CR-2).
 *   - Missing / malformed tenant in claims → 401 (no 'default' bleed).
 */

import crypto from 'node:crypto';
import type {
  EntityHandlerConfig,
  EntityHandlerContext,
  ScopedTokenClaims,
} from './types.js';
import { TenantMismatchError } from './errors.js';

export interface EntityHandlerRegistration {
  /** Maps entity qualified name ("org.period@v1") to its config. */
  entities: Record<string, EntityHandlerConfig>;
  /** How to verify an incoming scoped JWT. */
  verifier: TokenVerifier;
  /**
   * Optional defense-in-depth IP allowlist. When set, the dispatcher
   * rejects requests whose client IP (from `X-Forwarded-For` or the
   * socket remote) is not in one of these CIDR ranges. This catches
   * gateway misconfiguration where public traffic reaches the service.
   * CIDRs are comma-separated when read from an env var, or passed as
   * an array when configured programmatically. See CR-9.
   */
  allowedCidrs?: string[];
  /** Optional hook called after successful auth — good for metrics. */
  onRequest?: (ctx: EntityHandlerContext & { entityName: string; version: string }) => void;
}

export interface TokenVerifier {
  verify(token: string): ScopedTokenClaims;
}

type SupportedAlgo = 'EdDSA' | 'RS256' | 'HS256';

interface IssuerKey {
  publicKey: string;
  algo: SupportedAlgo;
}

const REGISTRY_ISSUER = 'anby-registry';

/**
 * Registry-public-key verifier. Fetches /registry/entity-token/public-key
 * at boot and verifies every scoped JWT with it. Cached in memory.
 *
 * Single-issuer (registry only). For accepting tokens from service-app
 * issuers (e.g. god-brain self-signing feed-pull requests), use
 * MultiIssuerVerifier or createAppVerifier({ acceptIssuers: [...] }).
 */
export class RegistryPublicKeyVerifier implements TokenVerifier {
  private key: IssuerKey | null = null;

  constructor(
    private readonly registryUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async init(): Promise<void> {
    this.key = await fetchRegistryEntityKey(this.registryUrl, this.fetchImpl);
  }

  verify(token: string): ScopedTokenClaims {
    if (!this.key) {
      throw new Error('RegistryPublicKeyVerifier not initialized');
    }
    return verifyJwtNative(token, [REGISTRY_ISSUER], (iss) => {
      if (iss !== REGISTRY_ISSUER) {
        throw new Error(`invalid issuer: ${iss}`);
      }
      return this.key!;
    });
  }
}

/**
 * Multi-issuer verifier. Accepts tokens from any issuer in `acceptIssuers`,
 * fetching each issuer's public key from the registry at init time.
 *
 * Issuer key resolution:
 *   - 'anby-registry'         → /registry/entity-token/public-key
 *   - '<service-appId>'       → /registry/services/{appId}/public-key
 *
 * Use this when an app needs to verify both registry-minted scoped tokens
 * AND tokens self-signed by other service apps (e.g. god-brain calling
 * /_anby/god-brain/feed with `iss = vn.bravebits.god-brain`).
 */
export class MultiIssuerVerifier implements TokenVerifier {
  private keys: Map<string, IssuerKey> = new Map();

  constructor(
    private readonly registryUrl: string,
    private readonly acceptIssuers: string[],
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (acceptIssuers.length === 0) {
      throw new Error('MultiIssuerVerifier requires at least one acceptIssuer');
    }
  }

  async init(): Promise<void> {
    for (const iss of this.acceptIssuers) {
      const key =
        iss === REGISTRY_ISSUER
          ? await fetchRegistryEntityKey(this.registryUrl, this.fetchImpl)
          : await fetchServicePublicKey(this.registryUrl, iss, this.fetchImpl);
      this.keys.set(iss, key);
    }
  }

  verify(token: string): ScopedTokenClaims {
    if (this.keys.size === 0) {
      throw new Error('MultiIssuerVerifier not initialized');
    }
    return verifyJwtNative(token, this.acceptIssuers, (iss) => {
      const key = this.keys.get(iss);
      if (!key) {
        throw new Error(`issuer not in allowlist: ${iss}`);
      }
      return key;
    });
  }
}

/**
 * Shared-secret verifier, for tests only.
 *
 * @deprecated Apps should use `createAppVerifier()` from
 *   '@anby/platform-sdk/entities'. Production deployments require the
 *   registry to have a real Ed25519/RSA keypair (`ENTITY_TOKEN_PRIVATE_KEY`).
 *   This class will be removed in v2.0.
 */
export class SharedSecretVerifier implements TokenVerifier {
  constructor(private readonly secret: string) {}

  verify(token: string): ScopedTokenClaims {
    return verifyJwtNative(token, [REGISTRY_ISSUER], () => ({
      publicKey: this.secret,
      algo: 'HS256',
    }));
  }
}

async function fetchRegistryEntityKey(
  registryUrl: string,
  fetchImpl: typeof fetch,
): Promise<IssuerKey> {
  const res = await fetchImpl(`${registryUrl}/registry/entity-token/public-key`);
  if (!res.ok) {
    throw new Error(`unable to fetch registry token public key (${res.status})`);
  }
  const json = (await res.json()) as { publicKey: string; algo?: string };
  return {
    publicKey: json.publicKey,
    algo: normalizeAlgo(json.algo),
  };
}

async function fetchServicePublicKey(
  registryUrl: string,
  appId: string,
  fetchImpl: typeof fetch,
): Promise<IssuerKey> {
  const res = await fetchImpl(
    `${registryUrl}/registry/services/${encodeURIComponent(appId)}/public-key`,
  );
  if (!res.ok) {
    throw new Error(
      `unable to fetch service public key for ${appId} (${res.status})`,
    );
  }
  const json = (await res.json()) as { publicKey: string; algo?: string };
  return {
    publicKey: json.publicKey,
    // Service-app keypairs are Ed25519 (see identity.ts generateAppKeyPair).
    // Honor advertised algo when present, default to EdDSA otherwise.
    algo: normalizeAlgo(json.algo, 'EdDSA'),
  };
}

function normalizeAlgo(
  algo: string | undefined,
  fallback: SupportedAlgo = 'RS256',
): SupportedAlgo {
  if (algo === 'HS256' || algo === 'RS256' || algo === 'EdDSA') return algo;
  return fallback;
}

function verifyJwtNative(
  token: string,
  acceptIssuers: string[],
  resolveKey: (iss: string) => IssuerKey,
): ScopedTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');
  const [h64, p64, s64] = parts;
  const header = safeJsonParse(base64urlDecode(h64).toString('utf8'));
  const payload = safeJsonParse(base64urlDecode(p64).toString('utf8'));
  const signature = base64urlDecode(s64);
  const signingInput = Buffer.from(`${h64}.${p64}`);

  if (typeof header.alg !== 'string') throw new Error('missing alg');

  // Resolve key by issuer BEFORE signature check — different issuers may
  // use different algorithms, so we need to know which key/algo applies.
  if (typeof payload.iss !== 'string' || !payload.iss) {
    throw new Error('missing issuer claim');
  }
  if (!acceptIssuers.includes(payload.iss)) {
    throw new Error(`invalid issuer: ${payload.iss}`);
  }
  const key = resolveKey(payload.iss);

  // Only accept the algo the issuer's key was registered with, to prevent
  // algorithm-confusion attacks.
  if (header.alg !== key.algo) {
    throw new Error(`algorithm mismatch: expected ${key.algo}, got ${header.alg}`);
  }

  let ok = false;
  if (header.alg === 'EdDSA') {
    const pubKey = crypto.createPublicKey(key.publicKey);
    ok = crypto.verify(null, signingInput, pubKey, signature);
  } else if (header.alg === 'RS256') {
    const pubKey = crypto.createPublicKey(key.publicKey);
    ok = crypto.verify('sha256', signingInput, pubKey, signature);
  } else if (header.alg === 'HS256') {
    const mac = crypto
      .createHmac('sha256', key.publicKey)
      .update(signingInput)
      .digest();
    ok = signature.length === mac.length && crypto.timingSafeEqual(mac, signature);
  } else {
    throw new Error(`unsupported algorithm: ${header.alg}`);
  }
  if (!ok) throw new Error('signature verification failed');

  // Standard claim checks: expiry + not-before.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    throw new Error('token expired');
  }
  if (typeof payload.nbf === 'number' && payload.nbf > now) {
    throw new Error('token not yet valid');
  }
  return assertAndReturnClaims(payload);
}

function base64urlDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    if (!v || typeof v !== 'object') throw new Error('non-object');
    return v as Record<string, unknown>;
  } catch {
    throw new Error('malformed JWT segment');
  }
}

function assertAndReturnClaims(decoded: unknown): ScopedTokenClaims {
  assertValidClaims(decoded);
  return decoded;
}

function assertValidClaims(claims: unknown): asserts claims is ScopedTokenClaims {
  if (!claims || typeof claims !== 'object') {
    throw new Error('invalid token claims');
  }
  const c = claims as Record<string, unknown>;
  if (typeof c.tenantId !== 'string' || !c.tenantId) {
    throw new Error('token missing tenantId claim');
  }
  if (typeof c.sub !== 'string' || !c.sub) {
    throw new Error('token missing sub (callerAppId) claim');
  }
  if (typeof c.scope !== 'string') {
    throw new Error('token missing scope claim');
  }
}

// ---------------------------------------------------------------------------
// HTTP-agnostic dispatcher
// ---------------------------------------------------------------------------

export interface DispatchRequest {
  method: string;
  pathname: string; // e.g. "/_anby/entities/org.period/v1/abc"
  searchParams: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  /** Socket remote address, when the transport can provide it. */
  remoteAddress?: string;
}

export interface DispatchResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const ENTITY_ROUTE_RE =
  /^\/_anby\/entities\/([^/]+)\/(v\d+)(?:\/(.*))?$/;

const HEALTH_ROUTE = '/_anby/health';

export async function dispatchEntityRequest(
  registration: EntityHandlerRegistration,
  req: DispatchRequest,
): Promise<DispatchResponse> {
  if (req.pathname === HEALTH_ROUTE) {
    return { status: 200, body: { status: 'ok' } };
  }

  const match = ENTITY_ROUTE_RE.exec(req.pathname);
  if (!match) {
    return { status: 404, body: { error: 'not a recognized entity route' } };
  }
  const entityName = decodeURIComponent(match[1]);
  const version = match[2];
  const subpath = match[3] ?? '';

  const qualified = `${entityName}@${version}`;
  const config = registration.entities[qualified];
  if (!config) {
    return {
      status: 404,
      body: { error: `entity ${qualified} not served by this app` },
    };
  }

  // Readiness probe — bypass auth so registry activation check can hit it.
  if (subpath === 'ready') {
    return { status: 200, body: { status: 'ready', entity: qualified } };
  }

  // ---- Defense-in-depth CIDR allowlist (CR-9) ----
  const allowedCidrs =
    registration.allowedCidrs ??
    (process.env.INTERNAL_CIDR_ALLOWLIST
      ? process.env.INTERNAL_CIDR_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean)
      : []);
  if (allowedCidrs.length > 0) {
    const clientIp = resolveClientIp(req);
    if (!clientIp || !ipInAnyCidr(clientIp, allowedCidrs)) {
      return { status: 404, body: { error: 'not found' } };
    }
  }

  // ---- AUTH (CR-2: JWT-only, never header-based) ----
  const authHeader = pickHeader(req.headers, 'authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return authError('missing bearer token');
  }
  let claims: ScopedTokenClaims;
  try {
    claims = registration.verifier.verify(authHeader.slice(7));
  } catch (err) {
    return authError(`token verification failed: ${(err as Error).message}`);
  }

  // ---- HMAC rejection guard: if anyone passed legacy headers, hard fail ----
  if (
    pickHeader(req.headers, 'x-internal-user') ||
    pickHeader(req.headers, 'x-internal-signature') ||
    pickHeader(req.headers, 'x-tenant-id')
  ) {
    return authError(
      'entity endpoints reject HMAC + x-tenant-id headers (use scoped JWT)',
    );
  }

  const tenantId = claims.tenantId;
  const callerAppId = claims.sub;
  const query: Record<string, string> = {};
  for (const [k, v] of req.searchParams.entries()) query[k] = v;

  const ctx: EntityHandlerContext = {
    tenantId,
    callerAppId,
    params: {},
    query,
  };

  if (registration.onRequest) {
    registration.onRequest({ ...ctx, entityName, version });
  }

  try {
    if (subpath === '' || subpath === '/') {
      if (!config.list) {
        return { status: 405, body: { error: 'list not supported' } };
      }
      const result = await config.list(ctx);
      return { status: 200, body: result };
    }
    // Treat the first path segment as the entity id.
    const id = subpath.split('/')[0];
    if (!config.getById) {
      return { status: 405, body: { error: 'getById not supported' } };
    }
    const row = await config.getById({ ...ctx, id });
    if (row === null || row === undefined) {
      return { status: 404, body: { error: 'not found' } };
    }
    return { status: 200, body: row };
  } catch (err) {
    if (err instanceof TenantMismatchError) {
      return authError('tenant mismatch');
    }
    const msg = (err as Error).message;
    return {
      status: 500,
      body: { error: `entity handler error: ${msg}` },
    };
  }
}

function authError(reason: string): DispatchResponse {
  return {
    status: 401,
    body: { error: 'unauthorized', reason },
    headers: { 'www-authenticate': 'Bearer' },
  };
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      if (Array.isArray(v)) return v[0];
      return v;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// IP allowlist helpers (CR-9 defense-in-depth)
// ---------------------------------------------------------------------------

function resolveClientIp(req: DispatchRequest): string | null {
  const xff = pickHeader(req.headers, 'x-forwarded-for');
  if (xff) {
    // X-Forwarded-For = "client, proxy1, proxy2". First entry is the
    // originator. We only trust this when the gateway strips any
    // caller-supplied XFF — assume that's true when the allowlist is in
    // effect.
    const first = xff.split(',')[0]?.trim();
    if (first) return normalizeIp(first);
  }
  if (req.remoteAddress) return normalizeIp(req.remoteAddress);
  return null;
}

function normalizeIp(ip: string): string {
  // Strip IPv6-mapped IPv4 prefix ("::ffff:10.0.0.1" → "10.0.0.1").
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

function ipInAnyCidr(ip: string, cidrs: string[]): boolean {
  for (const cidr of cidrs) {
    if (ipInCidr(ip, cidr)) return true;
  }
  return false;
}

function ipInCidr(ip: string, cidr: string): boolean {
  // Supports IPv4 only for now. IPv6 inside the cluster is rare for
  // Anby deployments; extending to v6 is a follow-up.
  const [range, bitsStr] = cidr.includes('/') ? cidr.split('/') : [cidr, '32'];
  const bits = Number(bitsStr);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    const n = Number(p);
    if (Number.isNaN(n) || n < 0 || n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

// ---------------------------------------------------------------------------
// Remix-flavored convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Converts a Remix Request into a DispatchRequest. Hoisted so services
 * can call it from their splat route loader.
 */
export function requestToDispatch(
  request: Request,
  remoteAddress?: string,
): DispatchRequest {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    method: request.method,
    pathname: url.pathname,
    searchParams: url.searchParams,
    headers,
    remoteAddress,
  };
}

export function dispatchResponseToResponse(
  r: DispatchResponse,
): Response {
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: {
      'content-type': 'application/json',
      ...(r.headers ?? {}),
    },
  });
}

export async function handleEntityRemixRequest(
  registration: EntityHandlerRegistration,
  request: Request,
): Promise<Response> {
  const dr = await dispatchEntityRequest(
    registration,
    requestToDispatch(request),
  );
  return dispatchResponseToResponse(dr);
}
