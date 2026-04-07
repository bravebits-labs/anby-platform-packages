import type { AnbyEvent } from '@anby/contracts';
import crypto from 'crypto';

export interface EventTransport {
  publish(event: AnbyEvent): Promise<void>;
}

class InMemoryTransport implements EventTransport {
  private events: AnbyEvent[] = [];

  async publish(event: AnbyEvent): Promise<void> {
    this.events.push(event);
  }

  getEvents(): AnbyEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

let _transport: EventTransport = new InMemoryTransport();

export function configureEventTransport(transport: EventTransport): void {
  _transport = transport;
}

export function createEvent<T>(params: {
  type: string;
  source: string;
  tenantId: string;
  actor: { userId: string; email: string };
  data: T;
  correlationId?: string;
}): AnbyEvent<T> {
  return {
    id: crypto.randomUUID(),
    type: params.type,
    source: params.source,
    tenantId: params.tenantId,
    timestamp: new Date().toISOString(),
    version: '1',
    correlationId: params.correlationId || crypto.randomUUID(),
    actor: params.actor,
    data: params.data,
  };
}

export async function publishEvent(event: AnbyEvent): Promise<void> {
  await _transport.publish(event);
}

/**
 * PostgresEventTransport writes events to the app_events DB table.
 * The Event Router service polls this table and routes events to consumers.
 * This is the Phase 1 transport. Phase 2 replaces with KafkaEventTransport.
 * App code doesn't change — only the transport configuration.
 */
export class PostgresEventTransport implements EventTransport {
  private pool: any;

  constructor(private connectionString: string) {}

  private async getPool() {
    if (!this.pool) {
      // Dynamic import to avoid requiring pg as a hard dependency.
      // @ts-ignore — `pg` is an optional peer dep; consumers that use
      // the Postgres transport must install it themselves.
      const { Pool } = await import('pg');
      this.pool = new Pool({ connectionString: this.connectionString });
    }
    return this.pool;
  }

  async publish(event: AnbyEvent): Promise<void> {
    const pool = await this.getPool();
    await pool.query(
      `INSERT INTO app_events (id, tenant_id, event_type, source_app_id, payload, processed, created_at)
       VALUES ($1, $2, $3, $4, $5, false, NOW())`,
      [event.id, event.tenantId, event.type, event.source, JSON.stringify(event)],
    );
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

export { InMemoryTransport };
