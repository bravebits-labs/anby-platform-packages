/**
 * Redis integration for the entity sharing layer (CR-6).
 *
 * Provides three pieces that all depend on a shared `ioredis` connection:
 *
 * 1. `RedisEntityCache` — implements `EntityCache` against Redis. Falls
 *    through to the in-memory cache if Redis is unreachable at call
 *    time, so a Redis outage degrades gracefully instead of taking the
 *    consumer down.
 *
 * 2. `startInvalidationSubscriber` — subscribes to
 *    `anby:invalidate:{tenantId}:{entity}@{version}` pub/sub channels
 *    and clears the corresponding cache keys from BOTH L1 (in-process
 *    LRU) and L2 (Redis). Pub/sub is acceptable here because
 *    invalidation miss = cache staleness ≤ TTL, not data corruption.
 *
 * 3. `startResolverMapSubscriber` — subscribes to a Redis Stream
 *    (`anby:registry:stream:{tenantId}`) for install/uninstall updates.
 *    Streams persist messages and track consumer offsets, so a reconnect
 *    catches up on missed updates. Failure mode: if catch-up breaks,
 *    we fall back to the polling reconciliation already wired in
 *    `resolver.ts`.
 *
 * Usage from a consumer (e.g. anby-okr-service) at boot:
 *
 *   import { configureRedis, startInvalidationSubscriber,
 *            startResolverMapSubscriber, RedisEntityCache,
 *            configureEntityCache } from '@anby/platform-sdk';
 *
 *   if (process.env.PLATFORM_REDIS_URL) {
 *     const redis = configureRedis(process.env.PLATFORM_REDIS_URL);
 *     configureEntityCache(new RedisEntityCache({ redis }));
 *     startInvalidationSubscriber({ redis, tenantIds: ['default'] });
 *     startResolverMapSubscriber({ redis, tenantIds: ['default'] });
 *   }
 *
 * `ioredis` is an OPTIONAL peer dependency — consumers who don't set
 * `PLATFORM_REDIS_URL` should never import this module.
 */

import type {
  default as IORedisDefault,
  RedisOptions,
} from 'ioredis';
import type { EntityCache } from './cache.js';
import { InMemoryEntityCache } from './cache.js';
import {
  bootstrapEntityMap,
  _injectEntityMap,
} from './resolver.js';
import type { EntityProviderEntry } from './types.js';

// We load ioredis dynamically so the SDK stays usable without the peer.
// Cast the type to a loose shape to avoid importing types at module load.
type RedisLike = InstanceType<typeof IORedisDefault>;

let _redis: RedisLike | null = null;

export interface ConfigureRedisOptions {
  /** Redis connection URL, e.g. redis://localhost:6379 */
  url: string;
  /** Advanced ioredis options. */
  options?: RedisOptions;
}

/**
 * Lazily instantiate the shared Redis client. Safe to call multiple
 * times — only the first call opens a connection. Later calls return
 * the same instance.
 */
export async function configureRedis(
  input: string | ConfigureRedisOptions,
): Promise<RedisLike> {
  if (_redis) return _redis;
  const cfg: ConfigureRedisOptions =
    typeof input === 'string' ? { url: input } : input;
  // Dynamic import — ioredis is an optional peer dep.
  // @ts-ignore
  const mod = await import('ioredis');
  const IORedisCtor = (mod.default ?? mod) as typeof IORedisDefault;
  _redis = new IORedisCtor(cfg.url, cfg.options ?? {});
  return _redis;
}

export function getRedisOrNull(): RedisLike | null {
  return _redis;
}

// ---------------------------------------------------------------------------
// Dual-level cache (L1 in-process LRU + L2 Redis)
// ---------------------------------------------------------------------------

export interface RedisEntityCacheOptions {
  redis: RedisLike;
  l1?: EntityCache;
  /** Default TTL applied when callers don't pass one. */
  defaultTtlMs?: number;
  /** Prefix for Redis keys. Defaults to "anby:entity:". */
  keyPrefix?: string;
}

export class RedisEntityCache implements EntityCache {
  private readonly l1: EntityCache;
  private readonly redis: RedisLike;
  private readonly defaultTtlMs: number;
  private readonly keyPrefix: string;
  private degraded = false;

  constructor(opts: RedisEntityCacheOptions) {
    this.redis = opts.redis;
    this.l1 = opts.l1 ?? new InMemoryEntityCache({ defaultTtlMs: 30_000 });
    this.defaultTtlMs = opts.defaultTtlMs ?? 300_000; // 5 min
    this.keyPrefix = opts.keyPrefix ?? 'anby:entity:';
  }

  private redisKey(logicalKey: string): string {
    return this.keyPrefix + logicalKey;
  }

  get(key: string): unknown | undefined {
    // L1 only — the async Redis read is deliberately NOT part of this
    // synchronous surface because EntityCache.get is sync. Redis reads
    // happen in getAsync below; callers of the entity client should go
    // through that helper. For the EntityCache interface contract, this
    // implementation behaves as an L1 cache.
    return this.l1.get(key);
  }

  /**
   * Async two-level read: L1 first, then L2 (Redis), then undefined.
   * Populates L1 on L2 hit. Catches Redis errors and falls back to L1.
   */
  async getAsync(key: string): Promise<unknown | undefined> {
    const l1Hit = this.l1.get(key);
    if (l1Hit !== undefined) return l1Hit;
    if (this.degraded) return undefined;
    try {
      const raw = await this.redis.get(this.redisKey(key));
      if (raw === null) return undefined;
      const value = JSON.parse(raw);
      this.l1.set(key, value, 30_000);
      return value;
    } catch (err) {
      this.markDegraded(err);
      return undefined;
    }
  }

  set(key: string, value: unknown, ttlMs?: number): void {
    this.l1.set(key, value, ttlMs);
    void this.setAsync(key, value, ttlMs).catch((err) =>
      this.markDegraded(err),
    );
  }

  private async setAsync(
    key: string,
    value: unknown,
    ttlMs?: number,
  ): Promise<void> {
    if (this.degraded) return;
    try {
      const serialized = JSON.stringify(value);
      const ttl = Math.max(1, Math.floor((ttlMs ?? this.defaultTtlMs) / 1000));
      await this.redis.set(this.redisKey(key), serialized, 'EX', ttl);
    } catch (err) {
      this.markDegraded(err);
    }
  }

  del(key: string): void {
    this.l1.del(key);
    if (this.degraded) return;
    void this.redis.del(this.redisKey(key)).catch((err) =>
      this.markDegraded(err),
    );
  }

  delPattern(prefix: string): void {
    this.l1.delPattern(prefix);
    if (this.degraded) return;
    void this.scanAndDelete(this.redisKey(prefix)).catch((err) =>
      this.markDegraded(err),
    );
  }

  private async scanAndDelete(redisPrefix: string): Promise<void> {
    // Use SCAN to avoid KEYS — safe for production.
    let cursor = '0';
    const pattern = redisPrefix + '*';
    do {
      const [next, batch] = (await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        '100',
      )) as [string, string[]];
      cursor = next;
      if (batch.length > 0) await this.redis.del(...batch);
    } while (cursor !== '0');
  }

  clear(): void {
    this.l1.clear();
    // Do NOT clear the whole redis keyspace — other consumers may share
    // this instance. Callers who really want to nuke must go through
    // delPattern with the prefix for their tenant.
  }

  private markDegraded(err: unknown): void {
    if (!this.degraded) {
      this.degraded = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[platform-sdk] RedisEntityCache degraded to L1-only: ${(err as Error).message}`,
      );
      // Try to recover after 30s.
      setTimeout(() => {
        this.degraded = false;
      }, 30_000).unref?.();
    }
  }
}

// ---------------------------------------------------------------------------
// Cache invalidation subscriber (pub/sub)
// ---------------------------------------------------------------------------

export interface InvalidationSubscriberOptions {
  redis: RedisLike;
  /** The consumer's local cache instance. Defaults to the SDK's global. */
  cache?: EntityCache;
  /** Tenants this consumer cares about. Use "*" for all. */
  tenantIds: string[] | '*';
}

const _invalidationSubscribers = new Map<string, RedisLike>();

/**
 * Subscribe to invalidation pub/sub channels for a set of tenants.
 * Returns a handle with `stop()` for test cleanup.
 */
export async function startInvalidationSubscriber(
  opts: InvalidationSubscriberOptions,
): Promise<{ stop: () => Promise<void> }> {
  // ioredis requires a separate connection for subscribers — pub/sub
  // mode locks the connection.
  const subscriber = opts.redis.duplicate();

  const patterns =
    opts.tenantIds === '*'
      ? ['anby:invalidate:*']
      : opts.tenantIds.map((t) => `anby:invalidate:${t}:*`);

  await subscriber.psubscribe(...patterns);

  const cache = opts.cache; // may be undefined — we'll resolve lazily
  subscriber.on('pmessage', async (_pattern, channel, _message) => {
    // channel format: anby:invalidate:{tenantId}:{entity}@{version}
    const parts = channel.split(':');
    if (parts.length < 4) return;
    const tenantId = parts[2];
    const entityQualified = parts.slice(3).join(':');
    const prefix = `${tenantId}:${entityQualified}:`;
    const target =
      cache ??
      (await import('./cache.js')).getEntityCache();
    target.delPattern(prefix);
  });

  const id = patterns.join('|');
  _invalidationSubscribers.set(id, subscriber);

  return {
    stop: async () => {
      try {
        await subscriber.punsubscribe(...patterns);
      } catch {
        /* already closed */
      }
      subscriber.disconnect();
      _invalidationSubscribers.delete(id);
    },
  };
}

export async function publishInvalidation(
  redis: RedisLike,
  tenantId: string,
  entityName: string,
  version: string = 'v1',
): Promise<void> {
  const channel = `anby:invalidate:${tenantId}:${entityName}@${version}`;
  await redis.publish(channel, '1');
}

// ---------------------------------------------------------------------------
// Resolver map subscriber (Redis Streams — durable)
// ---------------------------------------------------------------------------

export interface ResolverStreamOptions {
  redis: RedisLike;
  tenantIds: string[];
  /**
   * When set, start reading from this stream ID (e.g. persisted from a
   * previous run). Defaults to "$" which means "only new messages after
   * this subscriber started".
   */
  startFromId?: string;
}

interface StreamMessage {
  seq: number;
  type: 'install' | 'uninstall' | 'upgrade';
  tenantId: string;
  appId: string;
  entries?: Record<string, EntityProviderEntry>;
}

export async function startResolverMapSubscriber(
  opts: ResolverStreamOptions,
): Promise<{ stop: () => Promise<void> }> {
  let stopped = false;
  const streams = opts.tenantIds.map((t) => `anby:registry:stream:${t}`);
  const ids = new Map<string, string>();
  for (const s of streams) ids.set(s, opts.startFromId ?? '$');

  // Ensure we have an initial snapshot before we start listening for
  // deltas — avoids a race where the subscriber starts but the consumer
  // has no map loaded yet.
  for (const t of opts.tenantIds) {
    try {
      await bootstrapEntityMap(t);
    } catch {
      /* let the polling fallback in resolver handle this */
    }
  }

  const loop = async () => {
    while (!stopped) {
      try {
        const args: (string | number)[] = ['BLOCK', 5000, 'STREAMS'];
        for (const s of streams) args.push(s);
        for (const s of streams) args.push(ids.get(s)!);
        const result = (await (opts.redis as unknown as {
          xread: (...args: unknown[]) => Promise<unknown>;
        }).xread(...args)) as
          | null
          | Array<[string, Array<[string, string[]]>]>;
        if (!result) continue;
        for (const [stream, entries] of result) {
          for (const [id, fields] of entries) {
            ids.set(stream, id);
            const msg = parseStreamFields(fields);
            if (msg) applyStreamMessage(stream, msg);
          }
        }
      } catch (err) {
        if (stopped) return;
        // eslint-disable-next-line no-console
        console.warn(
          `[platform-sdk] resolver stream read failed: ${(err as Error).message}`,
        );
        // Back off briefly then retry — polling fallback still runs.
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
  };
  // Fire and forget — the loop stops when stopped=true.
  void loop();

  return {
    stop: async () => {
      stopped = true;
    },
  };
}

function parseStreamFields(fields: string[]): StreamMessage | null {
  // Redis streams field lists look like ["type", "install", "tenantId", ...]
  const map: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    map[fields[i]] = fields[i + 1];
  }
  if (!map.type || !map.tenantId) return null;
  return {
    seq: Number(map.seq ?? 0),
    type: map.type as StreamMessage['type'],
    tenantId: map.tenantId,
    appId: map.appId ?? '',
    entries: map.entries ? (JSON.parse(map.entries) as Record<string, EntityProviderEntry>) : undefined,
  };
}

function applyStreamMessage(_stream: string, msg: StreamMessage): void {
  // For Wave 1 we keep the update logic simple: any resolver message
  // triggers a re-bootstrap for that tenant. Phase 2.x can switch to
  // differential updates once we have a production workload to benchmark
  // against.
  bootstrapEntityMap(msg.tenantId).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn(
      `[platform-sdk] resolver refresh after stream update failed: ${(err as Error).message}`,
    );
  });
}

/**
 * Publish a registry stream message. Registry side uses this to notify
 * subscribers of install / uninstall / upgrade events.
 */
export async function publishResolverMapUpdate(
  redis: RedisLike,
  tenantId: string,
  update: {
    type: 'install' | 'uninstall' | 'upgrade';
    appId: string;
    seq?: number;
  },
): Promise<string> {
  const stream = `anby:registry:stream:${tenantId}`;
  // MAXLEN ~ keeps the stream bounded so it doesn't grow without limit.
  const id = (await (redis as unknown as {
    xadd: (...args: unknown[]) => Promise<string>;
  }).xadd(
    stream,
    'MAXLEN',
    '~',
    '10000',
    '*',
    'type',
    update.type,
    'tenantId',
    tenantId,
    'appId',
    update.appId,
    'seq',
    String(update.seq ?? Date.now()),
  )) as string;
  return id;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function _resetRedisModule(): void {
  _redis = null;
  _invalidationSubscribers.clear();
}

/** For tests: directly inject an entity map without going through the registry. */
export const _testInject = _injectEntityMap;
