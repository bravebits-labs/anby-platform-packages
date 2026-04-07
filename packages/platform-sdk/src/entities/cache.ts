/**
 * Entity response cache (Phase 1 = in-memory LRU).
 *
 * Interface is pluggable so Phase 2 can swap to Redis + pub/sub invalidation
 * without touching callers. Key format: "{tenantId}:{entity}@{version}:{pathHash}".
 */

import crypto from 'crypto';

export interface EntityCache {
  get(key: string): unknown | undefined;
  set(key: string, value: unknown, ttlMs?: number): void;
  del(key: string): void;
  delPattern(prefix: string): void;
  clear(): void;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class InMemoryEntityCache implements EntityCache {
  private readonly store = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;

  constructor(opts: { maxEntries?: number; defaultTtlMs?: number } = {}) {
    this.maxEntries = opts.maxEntries ?? 1000;
    this.defaultTtlMs = opts.defaultTtlMs ?? 30_000;
  }

  get(key: string): unknown | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh insertion order for LRU.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: unknown, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  del(key: string): void {
    this.store.delete(key);
  }

  delPattern(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }
}

let _cache: EntityCache = new InMemoryEntityCache();

export function configureEntityCache(cache: EntityCache): void {
  _cache = cache;
}

export function getEntityCache(): EntityCache {
  return _cache;
}

export function entityCacheKey(
  tenantId: string,
  entityName: string,
  version: string,
  path: string,
  query: Record<string, unknown> = {},
): string {
  const sortedQuery = JSON.stringify(
    Object.keys(query)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = query[k];
        return acc;
      }, {}),
  );
  const hash = crypto
    .createHash('sha256')
    .update(path + '|' + sortedQuery)
    .digest('hex')
    .slice(0, 16);
  return `${tenantId}:${entityName}@${version}:${hash}`;
}
