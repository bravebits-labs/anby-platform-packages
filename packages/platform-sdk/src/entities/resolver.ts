/**
 * Entity provider resolver (CR original Issue 4).
 *
 * Consumer SDK fetches the full entity map for a tenant from the registry
 * once (at boot, or on first entity access for a tenant) and keeps it in
 * process memory. Phase 2 adds Redis Streams subscription for live updates;
 * Phase 1 falls back to polling with ETag.
 *
 * Registry down at runtime does NOT break reads — the cached map keeps
 * serving. Only cold-start for a brand new tenant is blocked.
 */

import type {
  EntityMapResponse,
  EntityProviderEntry,
} from './types.js';
import { EntityNotInstalledError } from './errors.js';
import { registerEntitySchema } from './schema.js';
import { getPlatformConfig } from '../config/index.js';

interface TenantMap {
  entries: Map<string, EntityProviderEntry>;
  etag: string;
  fetchedAt: number;
}

const _tenantMaps = new Map<string, TenantMap>();
const _inflightBootstraps = new Map<string, Promise<TenantMap>>();

const POLL_INTERVAL_MS = 60_000;
const _pollTimers = new Map<string, NodeJS.Timeout>();

export async function bootstrapEntityMap(
  tenantId: string,
): Promise<TenantMap> {
  const existing = _tenantMaps.get(tenantId);
  if (existing) return existing;

  const pending = _inflightBootstraps.get(tenantId);
  if (pending) return pending;

  const promise = doFetch(tenantId).finally(() => {
    _inflightBootstraps.delete(tenantId);
  });
  _inflightBootstraps.set(tenantId, promise);
  const map = await promise;
  _tenantMaps.set(tenantId, map);
  startPolling(tenantId);
  return map;
}

async function doFetch(
  tenantId: string,
  ifNoneMatch?: string,
): Promise<TenantMap> {
  const { registryUrl } = getPlatformConfig();
  const url = `${registryUrl}/registry/entity-map?tenantId=${encodeURIComponent(tenantId)}`;
  const res = await fetch(url, {
    headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {},
  });
  if (res.status === 304) {
    // Not modified — keep current map, just bump fetchedAt.
    const cur = _tenantMaps.get(tenantId);
    if (cur) return { ...cur, fetchedAt: Date.now() };
    // 304 with no cached map is a contract violation: we only send
    // if-none-match when we already have a map, so the server should
    // never reply 304 to a cold caller. Surface a clear message instead
    // of falling through to the generic !res.ok branch which would say
    // "fetch failed (304)" and look like a real failure.
    throw new Error(
      `registry returned 304 Not Modified for tenant ${tenantId} but no cached entity-map exists — likely a stale ETag was sent or the cache was cleared mid-flight`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `registry entity-map fetch failed (${res.status}) for tenant ${tenantId}`,
    );
  }
  const json = (await res.json()) as EntityMapResponse;
  const entries = new Map<string, EntityProviderEntry>();
  for (const [key, value] of Object.entries(json.entries)) {
    entries.set(key, value);
    // Register schema for validation
    if (value.schema) {
      await registerEntitySchema(value.entityName, value.version, value.schema);
    }
  }
  return {
    entries,
    etag: json.etag,
    fetchedAt: Date.now(),
  };
}

function startPolling(tenantId: string): void {
  if (_pollTimers.has(tenantId)) return;
  const timer = setInterval(() => {
    const cur = _tenantMaps.get(tenantId);
    doFetch(tenantId, cur?.etag)
      .then((map) => {
        _tenantMaps.set(tenantId, map);
      })
      .catch((err) => {
        // Swallow — we keep serving from the cached map. Log for visibility.
        // eslint-disable-next-line no-console
        console.warn(
          `[platform-sdk] entity-map poll failed for tenant ${tenantId}: ${(err as Error).message}`,
        );
      });
  }, POLL_INTERVAL_MS);
  // Don't block process exit.
  if (typeof timer.unref === 'function') timer.unref();
  _pollTimers.set(tenantId, timer);
}

export function resolveEntityProvider(
  tenantId: string,
  entityName: string,
  version: string = 'v1',
): EntityProviderEntry {
  const map = _tenantMaps.get(tenantId);
  if (!map) {
    throw new EntityNotInstalledError(
      `${entityName}@${version}`,
      tenantId,
    );
  }
  const key = `${entityName}@${version}`;
  const entry = map.entries.get(key);
  if (!entry) {
    throw new EntityNotInstalledError(
      `${entityName}@${version}`,
      tenantId,
    );
  }
  return entry;
}

/** Await bootstrap if needed, then resolve. */
export async function ensureAndResolveEntityProvider(
  tenantId: string,
  entityName: string,
  version: string = 'v1',
): Promise<EntityProviderEntry> {
  if (!_tenantMaps.has(tenantId)) {
    await bootstrapEntityMap(tenantId);
  }
  return resolveEntityProvider(tenantId, entityName, version);
}

// ---------------------------------------------------------------------------
// Test / manual hooks
// ---------------------------------------------------------------------------

export function _injectEntityMap(
  tenantId: string,
  entries: Record<string, EntityProviderEntry>,
): void {
  _tenantMaps.set(tenantId, {
    entries: new Map(Object.entries(entries)),
    etag: 'test',
    fetchedAt: Date.now(),
  });
}

export function _clearResolver(): void {
  for (const timer of _pollTimers.values()) clearInterval(timer);
  _pollTimers.clear();
  _tenantMaps.clear();
  _inflightBootstraps.clear();
}
