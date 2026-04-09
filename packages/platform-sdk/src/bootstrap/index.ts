/**
 * Third-party app bootstrap (PLAN-app-bootstrap.md PR2).
 *
 * `bootstrapFromToken({ appToken })` is the SINGLE platform-init call a
 * third-party app needs at boot. Given a connection-string token, it:
 *
 *   1. Parses the token (sync, no network) → appId, platformUrl, privateKey
 *   2. Fetches GET ${platformUrl}/registry/discovery (cached on success)
 *   3. Fetches GET ${endpoints.authPublicKeyUrl} (the user JWT verification key)
 *   4. Configures the SDK's auth, platform, and entity-identity layers
 *   5. Schedules a background refresh at 80% of cacheTtlSeconds
 *
 * After this returns, the app can use `requireAuth()`, `verifyUserJwt()`,
 * `publishEvent()`, the entity client, etc. exactly as if it had been
 * configured via the legacy env-based path.
 *
 * Cache: discovery is cached to disk so cold starts survive a brief
 * registry outage. The token itself is NOT cached — it lives in the env
 * var. Cached entries are per-app and contain only public information
 * (URLs and the auth public key PEM, no secrets).
 */

import { configureAuth } from '../auth/index.js';
import { configurePlatform } from '../config/index.js';
import { configureAppIdentity } from '../entities/identity.js';
import { configureEventTransport } from '../events/index.js';
import { HttpEventTransport } from '../events/http-transport.js';
import { readCache, writeCache } from './cache.js';
import {
  ANBY_TOKEN_PREFIX,
  type AnbyAppToken,
  type CachedBootstrap,
  type DiscoveryResponse,
} from './types.js';

export { ANBY_TOKEN_PREFIX, type AnbyAppToken, type DiscoveryResponse };

// PLAN-app-bootstrap-phase2 PR3: shared bootstrap state.
//
// Module-level cache so multiple callers (entry.server, autoPublishOnBoot,
// entity-handler) all see the same discovery + identity once any one of
// them has called bootstrapFromToken. Without this, autoPublishOnBoot
// would have to read process.env.REGISTRY_URL again — defeating the
// goal of zero env vars.
interface BootstrapState {
  promise: Promise<void>;
  discovery?: DiscoveryResponse;
  appToken?: AnbyAppToken;
}

let _state: BootstrapState | null = null;

/** For tests: clears the module-level bootstrap state so a fresh
 *  bootstrapFromToken call re-runs from scratch. Not exported from the
 *  root barrel. */
export function _resetBootstrapForTests(): void {
  _state = null;
}

/**
 * Returns the discovery response cached by the most recent successful
 * bootstrapFromToken call. Throws if bootstrap has not yet started.
 *
 * Resolves the in-progress promise if bootstrap is still in flight, so
 * callers can `await getDiscoveredEndpoints()` from anywhere safely.
 */
export async function getDiscoveredEndpoints(): Promise<
  DiscoveryResponse['endpoints']
> {
  if (!_state) {
    throw new Error(
      'bootstrap not started — call bootstrapFromToken() before reading discovery state',
    );
  }
  await _state.promise;
  if (!_state.discovery) {
    throw new Error('bootstrap completed but no discovery cached');
  }
  return _state.discovery.endpoints;
}

/**
 * Returns the registry HOST root (e.g. "http://localhost:3003"), without
 * the /registry path suffix. Use this for callers that already append
 * /registry/... themselves (autoPublishOnBoot, RegistryPublicKeyVerifier).
 *
 * Falls back to discovery.endpoints.registryUrl with /registry stripped
 * if the registryBaseUrl field is missing (older registries that haven't
 * deployed PR3 yet).
 */
export async function getDiscoveredRegistryBaseUrl(): Promise<string> {
  const endpoints = await getDiscoveredEndpoints();
  if (endpoints.registryBaseUrl) return endpoints.registryBaseUrl;
  // Backward compat: strip /registry suffix from registryUrl.
  return endpoints.registryUrl.replace(/\/registry\/?$/, '');
}

export interface BootstrapOptions {
  appToken: string;
  /** Where to write the disk cache. Default: process.cwd() + "/.anby-cache". */
  cacheDir?: string;
  /** Override the discovery fetch (for tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Parse an `anby_v1_<base64json>` token. Throws on malformed input.
 *
 * Sync, no network. Validates structure but does NOT verify the
 * Ed25519 private key against any server — that happens later when the
 * SDK tries to mint a scoped-token.
 */
export function parseAppToken(token: string): AnbyAppToken {
  if (!token || typeof token !== 'string') {
    throw new Error('ANBY_APP_TOKEN is empty');
  }
  if (!token.startsWith(ANBY_TOKEN_PREFIX)) {
    throw new Error(
      `ANBY_APP_TOKEN must start with "${ANBY_TOKEN_PREFIX}". Did you paste the right value?`,
    );
  }
  const b64 = token.slice(ANBY_TOKEN_PREFIX.length);

  let json: string;
  try {
    json = Buffer.from(b64, 'base64url').toString('utf-8');
  } catch (err) {
    throw new Error(
      `ANBY_APP_TOKEN payload is not valid base64url: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `ANBY_APP_TOKEN payload is not valid JSON: ${(err as Error).message}`,
    );
  }

  const obj = parsed as Partial<AnbyAppToken>;
  if (
    obj?.v !== 1 ||
    typeof obj.appId !== 'string' ||
    typeof obj.platformUrl !== 'string' ||
    typeof obj.privateKey !== 'string'
  ) {
    throw new Error(
      'ANBY_APP_TOKEN payload missing required fields (v, appId, platformUrl, privateKey)',
    );
  }
  if (!obj.privateKey.includes('PRIVATE KEY')) {
    throw new Error('ANBY_APP_TOKEN.privateKey is not a PEM');
  }

  return {
    v: 1,
    appId: obj.appId,
    platformUrl: obj.platformUrl.replace(/\/$/, ''),
    privateKey: obj.privateKey,
  };
}

async function fetchDiscovery(
  platformUrl: string,
  fetchImpl: typeof fetch,
): Promise<DiscoveryResponse> {
  const url = `${platformUrl}/registry/discovery`;
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`discovery fetch failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as DiscoveryResponse;
  if (body?.v !== 1 || !body?.endpoints?.authPublicKeyUrl) {
    throw new Error('discovery response is missing required fields');
  }
  return body;
}

async function fetchAuthPublicKey(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const res = await fetchImpl(url, { headers: { accept: 'text/plain' } });
  if (!res.ok) {
    throw new Error(
      `auth-public-key fetch failed: ${res.status} ${res.statusText}`,
    );
  }
  const pem = await res.text();
  // CRITICAL leak check FIRST: a buggy auth-service that accidentally
  // serves a private key on this endpoint must be rejected loudly,
  // before any other validation that might mask the security finding.
  if (pem.includes('PRIVATE KEY')) {
    throw new Error(
      'auth-public-key endpoint returned PRIVATE KEY material — refusing to use it',
    );
  }
  if (!pem.includes('BEGIN PUBLIC KEY')) {
    throw new Error('auth-public-key response is not a PEM public key');
  }
  return pem;
}

/**
 * The single bootstrap entrypoint a third-party app calls at boot.
 *
 * Idempotent: if called multiple times in the same process (e.g. once
 * from entry.server.tsx and again from a refresh timer), the second call
 * returns the same in-flight promise instead of starting a parallel
 * bootstrap.
 *
 * @example
 * ```ts
 * import { bootstrapFromToken, requireAuth } from '@anby/platform-sdk';
 *
 * await bootstrapFromToken({ appToken: process.env.ANBY_APP_TOKEN! });
 *
 * app.get('/api/widgets', requireAuth(), handler);
 * ```
 */
export function bootstrapFromToken(opts: BootstrapOptions): Promise<void> {
  // PLAN-app-bootstrap-phase2 PR3: dedupe concurrent calls. Multiple
  // entry points (entry.server, autoPublishOnBoot, refresh timer) can
  // all await the same shared promise without spawning parallel work.
  if (_state) return _state.promise;
  _state = {
    promise: doBootstrap(opts).catch((err) => {
      // Failed bootstrap clears state so the next call retries.
      _state = null;
      throw err;
    }),
  };
  return _state.promise;
}

async function doBootstrap(opts: BootstrapOptions): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error(
      'No fetch implementation available. Pass opts.fetchImpl or run on Node 18+.',
    );
  }
  const cacheDir = opts.cacheDir ?? `${process.cwd()}/.anby-cache`;

  // 1. Parse the token (sync, no network)
  const token = parseAppToken(opts.appToken);
  if (_state) _state.appToken = token;

  // 2. Try fetching fresh discovery + auth public key. Fall back to disk
  //    cache if the network is unreachable on cold start.
  let discovery: DiscoveryResponse;
  let authPublicKeyPem: string;
  let usedCache = false;

  try {
    discovery = await fetchDiscovery(token.platformUrl, fetchImpl);
    authPublicKeyPem = await fetchAuthPublicKey(
      discovery.endpoints.authPublicKeyUrl,
      fetchImpl,
    );
  } catch (fetchErr) {
    const cached = await readCache(cacheDir, token.appId);
    if (!cached) {
      throw new Error(
        `bootstrap failed and no cache available: ${(fetchErr as Error).message}`,
      );
    }
    discovery = cached.discovery;
    authPublicKeyPem = cached.authPublicKeyPem;
    usedCache = true;
  }

  // Cache discovery into the shared module state so other modules can
  // read it via getDiscoveredEndpoints() / getDiscoveredRegistryBaseUrl().
  if (_state) _state.discovery = discovery;

  // 3. Configure SDK subsystems
  configureAuth({ jwtPublicKey: authPublicKeyPem });
  configurePlatform({
    appId: token.appId,
    // Normalize to the registry HOST root (no /registry suffix). The
    // discovery wire contract returns registryUrl WITH /registry appended
    // for back-compat, but every in-process consumer of
    // getPlatformConfig().registryUrl (resolver, token, handler) builds
    // its own /registry/... path on top, so storing the suffixed form
    // produces /registry/registry/... 404s. Same strip getDiscoveredRegistryBaseUrl uses.
    registryUrl: discovery.endpoints.registryUrl.replace(/\/registry\/?$/, ''),
  });
  configureAppIdentity({
    appId: token.appId,
    privateKeyPem: token.privateKey,
  });

  // PLAN-app-bootstrap-phase2 PR3: auto-wire HttpEventTransport so dev
  // calls to publishEvent() work without any manual configuration. The
  // events endpoint URL comes from discovery — fall back to deriving it
  // from registryBaseUrl if older discovery responses lack the explicit
  // eventsUrl field.
  const eventsUrl =
    discovery.endpoints.eventsUrl ??
    `${discovery.endpoints.registryBaseUrl ?? discovery.endpoints.registryUrl.replace(/\/registry\/?$/, '')}/registry/events`;
  configureEventTransport(
    new HttpEventTransport({
      endpoint: eventsUrl,
      identity: { appId: token.appId, privateKeyPem: token.privateKey },
    }),
  );

  // 4. Persist to cache (only on successful network fetch — don't
  //    overwrite a fresh cache with a stale-cache value)
  if (!usedCache) {
    const fetchedAt = new Date();
    const staleAt = new Date(fetchedAt.getTime() + discovery.cacheTtlSeconds * 1000);
    const entry: CachedBootstrap = {
      fetchedAt: fetchedAt.toISOString(),
      staleAt: staleAt.toISOString(),
      discovery,
      authPublicKeyPem,
    };
    try {
      await writeCache(cacheDir, token.appId, entry);
    } catch (err) {
      // Cache write failure is non-fatal. The SDK still works in memory;
      // the next cold start just can't use the disk fallback.
      console.warn(
        `[anby] failed to write bootstrap cache: ${(err as Error).message}`,
      );
    }
  }

  // 5. Schedule background refresh at 80% of TTL.
  const refreshInMs = Math.max(60_000, discovery.cacheTtlSeconds * 1000 * 0.8);
  scheduleRefresh(opts, refreshInMs);
}

/**
 * Background refresh loop. Re-runs bootstrapFromToken at the scheduled
 * interval. On failure, logs and keeps using the existing in-memory
 * config — there's no degraded mode because the data we cache (URLs +
 * public key) is not security-critical and can be stale.
 */
function scheduleRefresh(opts: BootstrapOptions, delayMs: number): void {
  const handle = setTimeout(() => {
    bootstrapFromToken(opts).catch((err) => {
      console.warn(
        `[anby] bootstrap refresh failed: ${(err as Error).message} (will retry on next interval)`,
      );
      // Re-schedule with the same delay even on failure.
      scheduleRefresh(opts, delayMs);
    });
  }, delayMs);
  // Don't keep the event loop alive just for refresh.
  if (typeof handle.unref === 'function') handle.unref();
}
