import type { Clock } from '../clock/clock';
import type { Database } from '../db/database';
import type { UnitOfWork } from '../db/unit-of-work';
import type { Logger } from '../observability/logger';
import { withRequestContext, newTraceId } from '../observability/logger';
import type { DeliveredEvent, EventHandler } from './idempotent-consumer';

export type RelayOptions = {
  uow: UnitOfWork;
  database: Database;
  handlers: EventHandler[];
  clock: Clock;
  logger: Logger;
  batchSize?: number;
  claimTimeoutMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  pollMs?: number;
  instanceId?: string;
};

type OutboxRow = {
  id: string;
  tenant_id: string;
  name: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  attempts: number;
};

/**
 * The relay: claim, dispatch, mark published.
 *
 * Claiming is ONE statement with `FOR UPDATE SKIP LOCKED`, so two relays never
 * take the same row — concurrency is settled by the database, not by an
 * application-level check-then-act. A row is marked published only after every
 * matching handler's transaction has committed, so a relay that dies mid-dispatch
 * loses nothing: its claim goes stale and another relay picks the row up.
 *
 * There is NO ordering guarantee (MIO-001 Q1). Every consumer's effect must be
 * idempotent and commutative; a feature that needs ordering changes the claim to
 * be per aggregate, which is a change to one query.
 */
export class OutboxRelay {
  private readonly batchSize: number;
  private readonly claimTimeoutMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly instanceId: string;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly options: RelayOptions) {
    this.batchSize = options.batchSize ?? 25;
    this.claimTimeoutMs = options.claimTimeoutMs ?? 60_000;
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 300_000;
    this.instanceId = options.instanceId ?? `relay-${process.pid}`;
  }

  async drainOnce(): Promise<number> {
    const rows = await this.claim();
    let dispatched = 0;
    for (const row of rows) {
      const event = toDelivered(row);
      const handlers = this.options.handlers.filter((h) => h.eventName === row.name);
      try {
        await withRequestContext({ traceId: newTraceId(), tenantId: row.tenant_id }, async () => {
          for (const handler of handlers) await handler.consume(event);
        });
        await this.markPublished(row.id);
        dispatched += 1;
      } catch (error) {
        await this.recordFailure(row, error);
      }
    }
    return dispatched;
  }

  start(): void {
    if (this.timer) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        await this.drainOnce();
      } catch (error) {
        this.options.logger.error({ err: String(error) }, 'outbox relay tick failed');
      }
      if (this.running) this.timer = setTimeout(tick, this.options.pollMs ?? 250);
    };
    this.timer = setTimeout(tick, 0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * One statement: pick due, unclaimed (or abandoned) rows with SKIP LOCKED and
   * stamp them as ours. Two relays running this concurrently get disjoint sets.
   */
  private async claim(): Promise<OutboxRow[]> {
    // An ISO string with an explicit cast, not a Date: under vitest the driver
    // hands a Date straight to Buffer.byteLength and throws, while the same code
    // works under tsx. See AGENTS.md — raw `sql` parameters are always strings.
    const now = this.options.clock.now().toISOString();
    const rows = await this.options.database.sql<OutboxRow[]>`
      with candidates as (
        select id
          from infra.outbox
         where published_at is null
           and next_attempt_at <= ${now}::timestamptz
           and (claimed_at is null or claimed_at < now() - make_interval(secs => ${this.claimTimeoutMs / 1000}))
         order by id
           for update skip locked
         limit ${this.batchSize}
      )
      update infra.outbox o
         set claimed_at = now(), claimed_by = ${this.instanceId}
        from candidates c
       where o.id = c.id
      returning o.id, o.tenant_id, o.name, o.aggregate_type, o.aggregate_id,
                o.payload, o.occurred_at, o.attempts
    `;
    return rows;
  }

  private async markPublished(id: string): Promise<void> {
    await this.options.database.sql`
      update infra.outbox
         set published_at = now(), claimed_at = null, claimed_by = null, last_error = null
       where id = ${id}
    `;
  }

  private async recordFailure(row: OutboxRow, error: unknown): Promise<void> {
    const attempts = row.attempts + 1;
    const backoff = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** attempts);
    const nextAttemptAt = new Date(this.options.clock.now().getTime() + backoff).toISOString();
    this.options.logger.warn(
      { outboxId: row.id, event: row.name, attempts, err: String(error) },
      'outbox dispatch failed, will retry',
    );
    await this.options.database.sql`
      update infra.outbox
         set attempts = ${attempts},
             last_error = ${String(error).slice(0, 2000)},
             next_attempt_at = ${nextAttemptAt}::timestamptz,
             claimed_at = null,
             claimed_by = null
       where id = ${row.id}
    `;
  }
}

function toDelivered(row: OutboxRow): DeliveredEvent {
  return {
    id: String(row.id),
    name: row.name,
    tenantId: row.tenant_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    occurredAt: row.occurred_at,
  };
}
