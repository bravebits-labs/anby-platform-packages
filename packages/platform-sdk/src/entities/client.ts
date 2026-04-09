/**
 * Entity client (consumer side).
 *
 * Usage:
 *   const client = await getEntityClient('tenant-1', 'org.period');
 *   const cycles = await client.list();
 *   const period = await client.getById('period-123');
 *
 * Under the hood:
 *   1. Resolver lookup → { appId, baseUrl, schema, version }
 *   2. Scoped token fetch (cached per caller+tenant)
 *   3. fetch(baseUrl/_anby/entities/{name}/{path}, Bearer <jwt>)
 *   4. LRU cache response by (tenant, entity, path, query)
 *   5. JSON Schema validate in dev mode
 *   6. On 401: clear token cache and retry once
 */

import {
  ensureAndResolveEntityProvider,
  resolveEntityProvider,
} from './resolver.js';
import { getScopedToken, invalidateToken } from './token.js';
import { getEntityCache, entityCacheKey } from './cache.js';
import { validateEntityPayload } from './schema.js';
import {
  EntityProviderUnreachableError,
  ScopedTokenError,
} from './errors.js';

export interface EntityClientOptions {
  /** Disable response cache for this call. */
  noCache?: boolean;
  /** Override response cache TTL. */
  cacheTtlMs?: number;
  /** Abort signal for timeout / cancellation. */
  signal?: AbortSignal;
}

export interface EntityClient<TRow = unknown> {
  list(query?: Record<string, unknown>, opts?: EntityClientOptions): Promise<TRow[]>;
  getById(id: string, opts?: EntityClientOptions): Promise<TRow | null>;
  /** Raw path under /_anby/entities/{entity} — escape hatch. */
  raw<T = unknown>(
    path: string,
    init?: RequestInit & EntityClientOptions,
  ): Promise<T>;
}

export async function getEntityClient<TRow = unknown>(
  tenantId: string,
  entityName: string,
  version: string = 'v1',
): Promise<EntityClient<TRow>> {
  // Ensure bootstrap now, but subsequent calls use the sync resolver.
  await ensureAndResolveEntityProvider(tenantId, entityName, version);

  const doFetch = async <T>(
    path: string,
    init: RequestInit & EntityClientOptions = {},
  ): Promise<T> => {
    const provider = resolveEntityProvider(tenantId, entityName, version);
    const cache = getEntityCache();
    const method = (init.method ?? 'GET').toUpperCase();
    const cacheable = !init.noCache && method === 'GET';
    const key = cacheable
      ? entityCacheKey(tenantId, entityName, version, path, {})
      : null;
    if (key) {
      const hit = cache.get(key);
      if (hit !== undefined) return hit as T;
    }

    const doRequest = async (): Promise<Response> => {
      const token = await getScopedToken(tenantId);
      const url = `${provider.baseUrl}/_anby/entities/${encodeURIComponent(
        entityName,
      )}/${version}${path.startsWith('/') ? path : '/' + path}`;
      return fetch(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          authorization: `Bearer ${token.token}`,
          accept: 'application/json',
        },
      });
    };

    let res: Response;
    try {
      res = await doRequest();
    } catch (err) {
      // Auth failures from getScopedToken propagate as ScopedTokenError —
      // those are NOT unreachability and must surface their real cause so
      // operators don't spend hours chasing a phantom network problem.
      if (err instanceof ScopedTokenError) throw err;
      throw new EntityProviderUnreachableError(
        `${entityName}@${version}`,
        provider.baseUrl,
        err,
      );
    }

    if (res.status === 401) {
      // Token may have expired mid-flight. Clear and retry exactly once.
      invalidateToken(tenantId);
      try {
        res = await doRequest();
      } catch (err) {
        if (err instanceof ScopedTokenError) throw err;
        throw new EntityProviderUnreachableError(
          `${entityName}@${version}`,
          provider.baseUrl,
          err,
        );
      }
      if (res.status === 401) {
        const text = await res.text().catch(() => '');
        throw new ScopedTokenError(
          `entity call unauthorized after retry: ${text}`,
          401,
        );
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `entity ${entityName}@${version} ${method} ${path} failed (${res.status}): ${text}`,
      );
    }

    const json = (await res.json()) as T;
    // Schema validation (dev mode) — validates the body or each array item.
    try {
      validateEntityPayload(entityName, version, json);
    } catch (err) {
      throw err;
    }

    if (key) {
      cache.set(key, json, init.cacheTtlMs);
    }
    return json;
  };

  return {
    async list(query, opts) {
      const qs = query ? buildQueryString(query) : '';
      return (await doFetch<TRow[]>(qs ? `/?${qs}` : '/', { ...opts })) ?? [];
    },

    async getById(id, opts) {
      try {
        return await doFetch<TRow | null>(`/${encodeURIComponent(id)}`, {
          ...opts,
        });
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes('(404)')
        ) {
          return null;
        }
        throw err;
      }
    },

    async raw(path, init) {
      return doFetch(path, init ?? {});
    },
  };
}

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) params.append(k, String(item));
    } else {
      params.set(k, String(v));
    }
  }
  return params.toString();
}
