import { and, eq, sql } from 'drizzle-orm';
import { scopedWhere } from '../../../../platform/db/scoped';
import { currentTenantId } from '../../../../platform/db/tenant-context';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import type { NewRedemption, RedemptionRepositoryPort } from '../../application/ports';
import type { Redemption, RedemptionStatus, RewardPayload } from '../../domain/redemption';
import { redemption } from './rewards.schema';

export class RedemptionRepository implements RedemptionRepositoryPort {
  constructor(private readonly uow: UnitOfWork) {}

  async create(input: NewRedemption): Promise<{ redemption: Redemption; claimed: boolean }> {
    const tenantId = currentTenantId();
    const inserted = await this.uow.tx
      .insert(redemption)
      .values({
        id: input.id,
        tenantId,
        playerId: input.playerId,
        itemId: input.itemId,
        price: input.price,
        reward: input.reward,
        idempotencyKey: input.idempotencyKey,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .onConflictDoNothing({ target: [redemption.tenantId, redemption.playerId, redemption.idempotencyKey] })
      .returning();

    if (inserted[0]) return { redemption: toRedemption(inserted[0]), claimed: true };

    const existing = await this.uow.tx
      .select()
      .from(redemption)
      .where(
        and(
          scopedWhere(redemption),
          eq(redemption.playerId, input.playerId),
          eq(redemption.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing[0]) throw new Error(`idempotency key ${input.idempotencyKey} conflicted but no redemption is visible`);
    return { redemption: toRedemption(existing[0]), claimed: false };
  }

  async findForPlayer(id: string, playerId: string): Promise<Redemption | null> {
    const rows = await this.uow.tx
      .select()
      .from(redemption)
      .where(and(scopedWhere(redemption), eq(redemption.id, id), eq(redemption.playerId, playerId)))
      .limit(1);
    return rows[0] ? toRedemption(rows[0]) : null;
  }

  async findById(id: string): Promise<Redemption | null> {
    const rows = await this.uow.tx
      .select()
      .from(redemption)
      .where(and(scopedWhere(redemption), eq(redemption.id, id)))
      .limit(1);
    return rows[0] ? toRedemption(rows[0]) : null;
  }

  /**
   * Move `pending_issuance` → `issuing`, exactly once. A conditional UPDATE, so
   * two workers cannot both start issuing the same reward.
   */
  async claimForIssuance(id: string, now: Date): Promise<Redemption | null> {
    const rows = await this.uow.tx
      .update(redemption)
      .set({ status: 'issuing', updatedAt: now })
      .where(and(scopedWhere(redemption), eq(redemption.id, id), eq(redemption.status, 'pending_issuance')))
      .returning();
    return rows[0] ? toRedemption(rows[0]) : null;
  }

  async markIssued(id: string, externalRef: string, now: Date): Promise<void> {
    await this.uow.tx
      .update(redemption)
      .set({ status: 'issued', externalRef, lastError: null, nextAttemptAt: null, updatedAt: now })
      .where(and(scopedWhere(redemption), eq(redemption.id, id)));
  }

  async scheduleRetry(id: string, attempts: number, error: string, nextAttemptAt: Date, now: Date): Promise<void> {
    await this.uow.tx
      .update(redemption)
      .set({
        status: 'pending_issuance',
        attempts,
        lastError: error.slice(0, 2000),
        nextAttemptAt,
        updatedAt: now,
      })
      .where(and(scopedWhere(redemption), eq(redemption.id, id)));
  }

  async markFailed(id: string, attempts: number, error: string, now: Date): Promise<void> {
    await this.uow.tx
      .update(redemption)
      .set({ status: 'failed', attempts, lastError: error.slice(0, 2000), nextAttemptAt: null, updatedAt: now })
      .where(and(scopedWhere(redemption), eq(redemption.id, id)));
  }

  async statusOf(id: string): Promise<RedemptionStatus | null> {
    const rows = await this.uow.tx
      .select({ status: redemption.status })
      .from(redemption)
      .where(and(scopedWhere(redemption), eq(redemption.id, id)))
      .limit(1);
    return (rows[0]?.status as RedemptionStatus | undefined) ?? null;
  }

  /**
   * Redemptions whose retry is due, across every tenant — this is the worker's
   * sweep, which runs outside any tenant scope and carries the tenant forward
   * from each row.
   *
   * Due-ness is measured against the SAME clock that scheduled it — the injected
   * one. The outbox relay mixes the two deliberately (it also detects dead
   * peers, which needs a shared clock); a retry schedule does not, and mixing
   * them here made attempt counts depend on how far the database clock had drifted
   * from the test's fixed one. Two attempts inside one drain, non-deterministically.
   */
  async dueForRetry(now: Date, limit: number): Promise<Array<{ id: string; tenantId: string }>> {
    const rows = await this.uow.tx.execute<{ id: string; tenant_id: string }>(sql`
      select id, tenant_id from rewards.redemption
       where status = 'pending_issuance'
         and next_attempt_at is not null
         and next_attempt_at <= ${now.toISOString()}::timestamptz
       order by next_attempt_at
       limit ${limit}
    `);
    return rows.map((row) => ({ id: row.id, tenantId: row.tenant_id }));
  }
}

function toRedemption(row: {
  id: string;
  tenantId: string;
  playerId: string;
  itemId: string;
  price: number;
  reward: unknown;
  status: string;
  attempts: number;
  lastError: string | null;
  externalRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Redemption {
  return {
    id: row.id,
    tenantId: row.tenantId,
    playerId: row.playerId,
    itemId: row.itemId,
    price: Number(row.price),
    reward: row.reward as RewardPayload,
    status: row.status as RedemptionStatus,
    attempts: Number(row.attempts),
    lastError: row.lastError,
    externalRef: row.externalRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
