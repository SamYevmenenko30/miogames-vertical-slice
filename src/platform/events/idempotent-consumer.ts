import { sql } from 'drizzle-orm';
import { withTenant } from '../db/tenant-context';
import type { UnitOfWork } from '../db/unit-of-work';
import { processedEvent } from './events.schema';

export type DeliveredEvent = {
  id: string;
  name: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
};

export interface EventHandler {
  readonly name: string;
  readonly eventName: string;
  consume(event: DeliveredEvent): Promise<void>;
}

/**
 * Delivery is at-least-once; effects are once. A consumer claims the event by
 * inserting into infra.processed_event INSIDE the same transaction as its effect:
 *
 *   - a redelivery finds the row and does nothing, but still acknowledges;
 *   - a handler that throws rolls back the claim with the effect, so the event is
 *     retried rather than silently marked done.
 *
 * Extending this class is mandatory for every consumer (AGENTS.md).
 */
export abstract class IdempotentConsumer implements EventHandler {
  abstract readonly name: string;
  abstract readonly eventName: string;

  protected constructor(protected readonly unitOfWork: UnitOfWork) {}

  async consume(event: DeliveredEvent): Promise<void> {
    // The tenant scope is entered HERE, around the transaction, not inside the
    // handler — because the unit of work issues `SET LOCAL app.tenant_id` when it
    // opens the transaction, and it can only do that if the tenant is already in
    // context. A handler that entered the scope itself left the DATABASE without
    // a tenant for the whole transaction: every scoped query still worked at the
    // application level, so nothing failed until row-level security arrived and
    // returned zero rows for everything (MIO-011).
    await withTenant(event.tenantId, async () => this.consumeInTenant(event));
  }

  private async consumeInTenant(event: DeliveredEvent): Promise<void> {
    await this.unitOfWork.withTransaction(async () => {
      const claimed = await this.unitOfWork.tx
        .insert(processedEvent)
        .values({ consumer: this.name, eventId: event.id })
        .onConflictDoNothing()
        .returning({ eventId: processedEvent.eventId });

      if (claimed.length === 0) return;
      await this.handle(event);
    });
  }

  protected abstract handle(event: DeliveredEvent): Promise<void>;
}

/** For a consumer that cannot extend the base class (rare), the same claim. */
export async function claimEvent(uow: UnitOfWork, consumer: string, eventId: string): Promise<boolean> {
  const claimed = await uow.tx.execute(
    sql`insert into infra.processed_event (consumer, event_id) values (${consumer}, ${eventId})
        on conflict do nothing returning event_id`,
  );
  return claimed.length > 0;
}
