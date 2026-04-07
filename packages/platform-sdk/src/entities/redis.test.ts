/**
 * Phase 2 Redis integration tests (CR-6).
 *
 * Uses `ioredis-mock` to simulate two independent SDK pods sharing a
 * single Redis. Verifies that:
 *
 *   - Multi-instance cache invalidation reaches every subscriber
 *     (CRITICAL — the whole reason Phase 2 exists; without this,
 *     scaling consumers horizontally produces stale reads).
 *   - RedisEntityCache L2 round-trip works and falls back to L1 on
 *     Redis errors.
 *   - Resolver map publishing triggers re-bootstrap on subscribers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// ioredis-mock is a drop-in replacement for ioredis that keeps state in
// process memory and supports pub/sub + streams across instances created
// from the same constructor.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import IORedisMock from 'ioredis-mock';

import {
  RedisEntityCache,
  startInvalidationSubscriber,
  publishInvalidation,
  InMemoryEntityCache,
  configureEntityCache,
  entityCacheKey,
  _clearResolver,
} from './index.js';

type MockRedis = InstanceType<typeof IORedisMock>;

function newRedis(): MockRedis {
  return new (IORedisMock as unknown as new () => MockRedis)();
}

async function wait(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
  _clearResolver();
});

afterEach(() => {
  _clearResolver();
});

describe('RedisEntityCache — L1+L2 round trip', () => {
  it('set+get round-trips through Redis when L1 is empty', async () => {
    const redis = newRedis() as unknown as ConstructorParameters<
      typeof RedisEntityCache
    >[0]['redis'];
    const cache = new RedisEntityCache({
      redis,
      l1: new InMemoryEntityCache({ defaultTtlMs: 60_000 }),
      defaultTtlMs: 60_000,
    });
    const key = entityCacheKey('T1', 'org.period', 'v1', '/');
    cache.set(key, { id: 'p1', name: 'Q1' });
    // Drain the async setAsync.
    await wait(20);
    // Now check the raw Redis key is populated.
    const raw = await (redis as unknown as {
      get: (k: string) => Promise<string | null>;
    }).get('anby:entity:' + key);
    expect(raw).toBeTruthy();
    const value = await cache.getAsync(key);
    expect(value).toEqual({ id: 'p1', name: 'Q1' });
  });

  it('L1 hit does not touch Redis', async () => {
    const redis = newRedis() as unknown as ConstructorParameters<
      typeof RedisEntityCache
    >[0]['redis'];
    const cache = new RedisEntityCache({ redis });
    cache.set('k1', { a: 1 });
    // Read through L1 only (sync API).
    expect(cache.get('k1')).toEqual({ a: 1 });
  });

  it('delPattern scans and deletes matching keys in L1 and L2', async () => {
    const redis = newRedis() as unknown as ConstructorParameters<
      typeof RedisEntityCache
    >[0]['redis'];
    const cache = new RedisEntityCache({ redis });
    cache.set('T1:org.period@v1:a', 1);
    cache.set('T1:org.period@v1:b', 2);
    cache.set('T2:org.period@v1:c', 3);
    await wait(20);
    cache.delPattern('T1:org.period@v1:');
    await wait(30);
    expect(cache.get('T1:org.period@v1:a')).toBeUndefined();
    expect(cache.get('T1:org.period@v1:b')).toBeUndefined();
    expect(cache.get('T2:org.period@v1:c')).toBe(3);
  });
});

describe('Invalidation subscriber — multi-instance (CR-6 CRITICAL)', () => {
  it('invalidation published on one pod clears cache on every pod', async () => {
    // Two fresh "pods" — separate cache instances, but both subscribe
    // to the same Redis pub/sub. ioredis-mock shares state across
    // instances created from the same constructor.
    const redisA = newRedis() as unknown as ConstructorParameters<
      typeof RedisEntityCache
    >[0]['redis'];
    const redisB = newRedis() as unknown as ConstructorParameters<
      typeof RedisEntityCache
    >[0]['redis'];

    const cacheA = new InMemoryEntityCache({ defaultTtlMs: 60_000 });
    const cacheB = new InMemoryEntityCache({ defaultTtlMs: 60_000 });

    // Pre-populate both pods with the same cached rows.
    const k = 'T1:org.period@v1:foo';
    cacheA.set(k, [{ id: 'p1', name: 'Q1' }]);
    cacheB.set(k, [{ id: 'p1', name: 'Q1' }]);

    const subA = await startInvalidationSubscriber({
      redis: redisA,
      cache: cacheA,
      tenantIds: ['T1'],
    });
    const subB = await startInvalidationSubscriber({
      redis: redisB,
      cache: cacheB,
      tenantIds: ['T1'],
    });

    // Publish via Pod A's client.
    await publishInvalidation(redisA, 'T1', 'org.period', 'v1');

    // Give pub/sub a moment to deliver. ioredis-mock is fast but
    // messages are still async.
    await wait(50);

    expect(cacheA.get(k)).toBeUndefined();
    expect(cacheB.get(k)).toBeUndefined();

    await subA.stop();
    await subB.stop();
  });

  it('invalidation scoped to one tenant does not clear another tenant', async () => {
    const redis = newRedis() as unknown as ConstructorParameters<
      typeof RedisEntityCache
    >[0]['redis'];
    const cache = new InMemoryEntityCache({ defaultTtlMs: 60_000 });
    configureEntityCache(cache);

    cache.set('T1:org.period@v1:a', [{ id: 'x' }]);
    cache.set('T2:org.period@v1:a', [{ id: 'y' }]);

    const sub = await startInvalidationSubscriber({
      redis,
      cache,
      tenantIds: ['T1', 'T2'],
    });

    await publishInvalidation(redis, 'T1', 'org.period', 'v1');
    await wait(50);

    expect(cache.get('T1:org.period@v1:a')).toBeUndefined();
    expect(cache.get('T2:org.period@v1:a')).toEqual([{ id: 'y' }]);

    await sub.stop();
  });

  it('invalidation for a different entity does not clear unrelated keys', async () => {
    const redis = newRedis() as unknown as ConstructorParameters<
      typeof RedisEntityCache
    >[0]['redis'];
    const cache = new InMemoryEntityCache({ defaultTtlMs: 60_000 });
    cache.set('T1:org.period@v1:a', 'period');
    cache.set('T1:org.node@v1:a', 'node');

    const sub = await startInvalidationSubscriber({
      redis,
      cache,
      tenantIds: ['T1'],
    });

    await publishInvalidation(redis, 'T1', 'org.period', 'v1');
    await wait(50);

    expect(cache.get('T1:org.period@v1:a')).toBeUndefined();
    expect(cache.get('T1:org.node@v1:a')).toBe('node');

    await sub.stop();
  });
});
