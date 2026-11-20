import { currentTenantId } from '../../../../platform/db/tenant-context';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import type { DedupRepositoryPort } from '../../application/ports';
import { dedup } from './ingestion.schema';

export class DedupRepository implements DedupRepositoryPort {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * `ON CONFLICT DO UPDATE ... RETURNING` rather than `DO NOTHING`, so the winner
   * comes back in both cases: with DO NOTHING a duplicate returns no row at all
   * and we would have to SELECT again — a second read that can itself race.
   */
  async claim(operatorEventId: string, eventId: string): Promise<{ eventId: string; claimed: boolean }> {
    const tenantId = currentTenantId();
    const [row] = await this.uow.tx
      .insert(dedup)
      .values({ tenantId, operatorEventId, eventId })
      .onConflictDoUpdate({
        target: [dedup.tenantId, dedup.operatorEventId],
        set: { operatorEventId },
      })
      .returning({ eventId: dedup.eventId });
    const winner = row!.eventId;
    return { eventId: winner, claimed: winner === eventId };
  }
}
