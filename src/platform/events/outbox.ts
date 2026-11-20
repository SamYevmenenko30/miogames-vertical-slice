import type { Clock } from '../clock/clock';
import type { UnitOfWork } from '../db/unit-of-work';
import { outbox } from './events.schema';

export type DomainEventInput = {
  /** `module.entity.verb` — see AGENTS.md. */
  name: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
};

export const EVENT_BUS = Symbol('EventBusPort');

export interface EventBusPort {
  publish(event: DomainEventInput): Promise<void>;
}

/**
 * The only way to emit a domain event.
 *
 * It writes into the CALLER's transaction, which is the entire point: there is no
 * code path where coins are credited and the event is lost, or the event fires and
 * the coins are not there (ADR-0003). Publishing outside a unit of work is refused
 * rather than silently auto-committed.
 */
export class OutboxEventBus implements EventBusPort {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async publish(event: DomainEventInput): Promise<void> {
    const now = this.clock.now();
    await this.uow.tx.insert(outbox).values({
      tenantId: event.tenantId,
      name: event.name,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      occurredAt: now,
      // Scheduling is ours and must be deterministic in a test, so it comes from
      // the injected clock. Claim staleness (below, in the relay) is about
      // detecting a dead peer and comes from the database, the only clock every
      // process shares.
      nextAttemptAt: now,
    });
  }
}
