/**
 * Tenant-scoped DB query helper (CR — plan Issue 5).
 *
 * Wraps a Drizzle table reference with a tenantId bound so every query
 * automatically filters by tenant_id. Developers inside entity handlers
 * cannot accidentally forget tenant isolation — if they somehow reach for
 * raw db.select() the handler's runtime guard will scream.
 *
 * Design note: we deliberately avoid tight coupling to Drizzle's internal
 * types here. The wrapper takes the user's `db` instance and the table
 * schema and provides a small set of helpers. Consumers keep using their
 * own Drizzle types for insert payloads etc; scopedDb only touches the
 * WHERE clause.
 *
 * Usage (inside createEntityHandler):
 *
 *   list: async ({ tenantId }) => {
 *     return scopedDb(db, orgPeriods, tenantId).list({
 *       where: (t, eq) => eq(t.active, true),
 *     });
 *   }
 */

type WhereClause<TTable> = (
  table: TTable,
  ops: {
    eq: (a: unknown, b: unknown) => unknown;
    and: (...args: unknown[]) => unknown;
  },
) => unknown;

export interface ScopedTableQuery<TRow> {
  list(opts?: {
    where?: WhereClause<unknown>;
    limit?: number;
    orderBy?: unknown;
  }): Promise<TRow[]>;
  findFirst(opts?: { where?: WhereClause<unknown> }): Promise<TRow | null>;
  findById(id: string | number): Promise<TRow | null>;
  count(opts?: { where?: WhereClause<unknown> }): Promise<number>;
}

/**
 * Minimal drizzle-shaped db interface we require. Consumers pass their
 * drizzle instance in; we only use .select().from() so the type surface
 * stays small and driver-agnostic.
 */
export interface DrizzleLike {
  select: (fields?: unknown) => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<unknown[]> & {
        limit?: (n: number) => unknown;
        orderBy?: (o: unknown) => unknown;
      };
    };
  };
}

export interface ScopedDbOptions<TTable> {
  tenantColumn?: keyof TTable & string; // default "tenantId"
  idColumn?: keyof TTable & string; // default "id"
}

/**
 * Build a scoped query factory. Returns helpers that transparently AND
 * `tenant_id = tenantId` into every query.
 *
 * NOTE: We take a reference to drizzle's `eq`/`and` ops so we don't have to
 * import them here (keeping drizzle as an optional peer). Callers pass the
 * ops explicitly via the `ops` argument below, or via the per-call `where`
 * clause which gets `ops` injected when invoked.
 */
export function scopedDb<TTable extends Record<string, unknown>, TRow>(params: {
  db: DrizzleLike;
  table: TTable;
  tenantId: string;
  ops: {
    eq: (a: unknown, b: unknown) => unknown;
    and: (...args: unknown[]) => unknown;
  };
  options?: ScopedDbOptions<TTable>;
}): ScopedTableQuery<TRow> {
  const tenantCol = (params.options?.tenantColumn ?? 'tenantId') as keyof TTable;
  const idCol = (params.options?.idColumn ?? 'id') as keyof TTable;
  if (!(tenantCol in params.table)) {
    throw new Error(
      `scopedDb: table does not have column "${String(tenantCol)}" — ` +
        `every table exposed via scopedDb must include the tenant column`,
    );
  }
  const tenantColumn = params.table[tenantCol];
  const ops = params.ops;

  const buildWhere = (userWhere?: WhereClause<TTable>) => {
    const tenantClause = ops.eq(tenantColumn, params.tenantId);
    if (!userWhere) return tenantClause;
    const extra = userWhere(params.table, ops);
    return ops.and(tenantClause, extra);
  };

  return {
    async list(opts) {
      const q = params.db
        .select()
        .from(params.table as unknown)
        .where(buildWhere(opts?.where as WhereClause<TTable> | undefined));
      // Limit / orderBy chaining — Drizzle returns a builder that's also
      // a thenable. We rely on userland to chain if needed via returned rows.
      const anyQ = q as unknown as {
        limit?: (n: number) => unknown;
        orderBy?: (o: unknown) => unknown;
      };
      let chained: unknown = q;
      if (opts?.orderBy && anyQ.orderBy)
        chained = (chained as { orderBy: (o: unknown) => unknown }).orderBy(
          opts.orderBy,
        );
      if (opts?.limit != null && (chained as { limit?: unknown }).limit)
        chained = (chained as { limit: (n: number) => unknown }).limit(
          opts.limit,
        );
      return (await (chained as Promise<TRow[]>)) ?? [];
    },

    async findFirst(opts) {
      const rows = await this.list({ where: opts?.where, limit: 1 });
      return rows[0] ?? null;
    },

    async findById(id) {
      return this.findFirst({
        where: (t, { eq }) => eq((t as Record<string, unknown>)[idCol as string], id),
      });
    },

    async count(opts) {
      const rows = await this.list({ where: opts?.where });
      return rows.length;
    },
  };
}

/**
 * Smaller, hand-rolled wrapper for services that want to plug scopedDb into
 * their own query helpers without importing drizzle ops at this layer. The
 * returned builder exposes the already-anded tenant clause so callers can
 * keep chaining.
 */
export function tenantClause<TTable>(params: {
  table: TTable;
  tenantId: string;
  eq: (a: unknown, b: unknown) => unknown;
  tenantColumn?: keyof TTable & string;
}): unknown {
  const col = (params.tenantColumn ?? 'tenantId') as keyof TTable;
  if (!(col in (params.table as Record<string, unknown>))) {
    throw new Error(
      `tenantClause: table missing "${String(col)}" column`,
    );
  }
  return params.eq(
    (params.table as Record<string, unknown>)[col as string],
    params.tenantId,
  );
}
