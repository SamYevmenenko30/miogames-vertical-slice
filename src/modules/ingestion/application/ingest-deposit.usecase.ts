import { randomUUID } from 'node:crypto';
import { CASINO_DEPOSIT_OBSERVED } from '../../../contracts/events';
import type { UnitOfWork } from '../../../platform/db/unit-of-work';
import type { EventBusPort } from '../../../platform/events/outbox';
import { IntegrationFacade } from '../../integration';
import type { IngestDecision } from '../domain/envelope';
import type { DedupRepositoryPort, EnvelopeRepositoryPort } from './ports';

/**
 * Accept-then-process, in one transaction.
 *
 * Everything that must agree — the envelope, the deduplication claim and the
 * outbox row — is written together. There is no state in which the event was
 * emitted but not recorded, or claimed but not emitted.
 */
export class IngestDepositUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly integration: IntegrationFacade,
    private readonly envelopes: EnvelopeRepositoryPort,
    private readonly dedup: DedupRepositoryPort,
    private readonly bus: EventBusPort,
  ) {}

  async execute(input: { tenantId: string; operator: string; raw: Record<string, unknown> }): Promise<IngestDecision> {
    const translation = this.integration.translateDeposit(input.operator, input.raw);

    return this.uow.withTransaction(async () => {
      if (translation.outcome === 'invalid' || translation.outcome === 'unsupported') {
        await this.envelopes.store({
          tenantId: input.tenantId,
          operator: input.operator,
          operatorEventId: readEventId(input.raw),
          raw: input.raw,
          outcome: translation.outcome,
          eventId: null,
          error: translation.reason,
        });
        return { outcome: translation.outcome, reason: translation.reason };
      }

      const event = translation.event;
      const eventId = randomUUID();
      const claim = await this.dedup.claim(event.operatorEventId, eventId);

      await this.envelopes.store({
        tenantId: input.tenantId,
        operator: input.operator,
        operatorEventId: event.operatorEventId,
        raw: input.raw,
        outcome: claim.claimed ? 'accepted' : 'duplicate',
        eventId: claim.eventId,
        error: null,
      });

      if (!claim.claimed) return { outcome: 'duplicate', eventId: claim.eventId };

      await this.bus.publish({
        name: CASINO_DEPOSIT_OBSERVED,
        tenantId: input.tenantId,
        aggregateType: 'deposit',
        aggregateId: eventId,
        payload: { ...event, eventId },
      });
      return { outcome: 'accepted', eventId };
    });
  }
}

/** Best-effort, for the audit trail only: an unreadable payload still gets stored. */
function readEventId(raw: Record<string, unknown>): string | null {
  const flat = raw.event_id;
  if (typeof flat === 'string' && flat.length > 0) return flat;
  const meta = raw.meta;
  if (typeof meta === 'object' && meta !== null) {
    const nested = (meta as Record<string, unknown>).eventId;
    if (typeof nested === 'string' && nested.length > 0) return nested;
  }
  return null;
}
