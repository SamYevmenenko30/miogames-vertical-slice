import { currentTenantId } from '../../../../platform/db/tenant-context';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import type { EnvelopeRepositoryPort } from '../../application/ports';
import type { StoredEnvelope } from '../../domain/envelope';
import { envelope } from './ingestion.schema';

export class EnvelopeRepository implements EnvelopeRepositoryPort {
  constructor(private readonly uow: UnitOfWork) {}

  async store(entry: StoredEnvelope): Promise<void> {
    // The tenant comes from context, not from the argument: an envelope stored
    // under a tenant the request did not authenticate as would be the leak.
    const tenantId = currentTenantId();
    await this.uow.tx.insert(envelope).values({
      tenantId,
      operator: entry.operator,
      operatorEventId: entry.operatorEventId,
      raw: entry.raw,
      outcome: entry.outcome,
      eventId: entry.eventId,
      error: entry.error,
    });
  }
}
