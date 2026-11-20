import { and, desc, eq, sql } from 'drizzle-orm';
import { scopedWhere } from '../../../../platform/db/scoped';
import { currentTenantId } from '../../../../platform/db/tenant-context';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import type { LedgerRepositoryPort } from '../../application/ports';
import type { Coins, LedgerDirection, LedgerEntry, Movement } from '../../domain/entry';
import { balance, entry } from './ledger.schema';

export class LedgerRepository implements LedgerRepositoryPort {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * The insert claims the idempotency key.
   *
   * `DO NOTHING` and then a read, NOT `DO UPDATE ... RETURNING` — which is what
   * `ingestion.dedup` uses. The difference is this table's append-only trigger:
   * `ON CONFLICT DO UPDATE` is an UPDATE, and the trigger refuses it. The read
   * that follows is safe because it is a new statement, and under READ COMMITTED
   * a new statement takes a fresh snapshot, so the row the conflict told us about
   * is visible.
   */
  async recordEntry(
    direction: LedgerDirection,
    movement: Movement,
    at: Date,
  ): Promise<{ entry: LedgerEntry; claimed: boolean }> {
    const tenantId = currentTenantId();
    const inserted = await this.uow.tx
      .insert(entry)
      .values({
        tenantId,
        playerId: movement.playerId,
        direction,
        coins: movement.coins,
        reason: movement.reason,
        idempotencyKey: movement.idempotencyKey,
        createdAt: at,
      })
      .onConflictDoNothing({ target: [entry.tenantId, entry.idempotencyKey] })
      .returning();

    if (inserted[0]) return { entry: toEntry(inserted[0]), claimed: true };

    const existing = await this.uow.tx
      .select()
      .from(entry)
      .where(and(scopedWhere(entry), eq(entry.idempotencyKey, movement.idempotencyKey)))
      .limit(1);
    if (!existing[0]) {
      throw new Error(`idempotency key ${movement.idempotencyKey} conflicted but no entry is visible`);
    }
    return { entry: toEntry(existing[0]), claimed: false };
  }

  async lockBalance(playerId: string): Promise<Coins> {
    const tenantId = currentTenantId();
    await this.uow.tx
      .insert(balance)
      .values({ tenantId, playerId, coins: 0 })
      .onConflictDoNothing({ target: [balance.tenantId, balance.playerId] });

    // FOR UPDATE: this is what makes two concurrent debits take turns rather than
    // both reading the same balance and both deciding they can afford it.
    const rows = await this.uow.tx.execute<{ coins: number }>(
      sql`select coins from ledger.balance where tenant_id = ${tenantId} and player_id = ${playerId} for update`,
    );
    return Number(rows[0]?.coins ?? 0);
  }

  async applyDelta(playerId: string, delta: number): Promise<Coins> {
    const [row] = await this.uow.tx
      .update(balance)
      .set({ coins: sql`${balance.coins} + ${delta}`, updatedAt: new Date() })
      .where(scopedWhere(balance, eq(balance.playerId, playerId)))
      .returning({ coins: balance.coins });
    return Number(row?.coins ?? 0);
  }

  async balanceOf(playerId: string): Promise<Coins> {
    const rows = await this.uow.tx
      .select({ coins: balance.coins })
      .from(balance)
      .where(scopedWhere(balance, eq(balance.playerId, playerId)))
      .limit(1);
    return Number(rows[0]?.coins ?? 0);
  }

  async history(playerId: string, limit: number): Promise<LedgerEntry[]> {
    const rows = await this.uow.tx
      .select()
      .from(entry)
      .where(and(scopedWhere(entry), eq(entry.playerId, playerId)))
      .orderBy(desc(entry.id))
      .limit(limit);
    return rows.map(toEntry);
  }
}

function toEntry(row: {
  id: number;
  tenantId: string;
  playerId: string;
  direction: string;
  coins: number;
  reason: string;
  idempotencyKey: string;
  createdAt: Date;
}): LedgerEntry {
  return {
    id: Number(row.id),
    tenantId: row.tenantId,
    playerId: row.playerId,
    direction: row.direction === 'debit' ? 'debit' : 'credit',
    coins: Number(row.coins),
    reason: row.reason,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}
