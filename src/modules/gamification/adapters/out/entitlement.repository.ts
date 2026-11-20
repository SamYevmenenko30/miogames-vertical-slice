import { and, eq, lte, sql } from 'drizzle-orm';
import { integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { scopedWhere } from '../../../../platform/db/scoped';
import { currentTenantId } from '../../../../platform/db/tenant-context';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import type { EntitlementRepositoryPort, NewEntitlement } from '../../application/ports';
import type { SpinEntitlement } from '../../domain/entitlement';

const gamification = pgSchema('gamification');

export const spinEntitlement = gamification.table('spin_entitlement', {
  id: uuid('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  playerId: uuid('player_id').notNull(),
  wheelId: text('wheel_id').notNull(),
  wheelVersion: integer('wheel_version').notNull(),
  ruleId: text('rule_id').notNull(),
  state: text('state').notNull().default('granted'),
  serverSeed: text('server_seed').notNull(),
  seedHash: text('seed_hash').notNull(),
  sourceEventId: text('source_event_id').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export class EntitlementRepository implements EntitlementRepositoryPort {
  constructor(private readonly uow: UnitOfWork) {}

  async grant(batch: NewEntitlement[]): Promise<void> {
    if (batch.length === 0) return;
    const tenantId = currentTenantId();
    await this.uow.tx.insert(spinEntitlement).values(batch.map((entry) => ({ ...entry, tenantId })));
  }

  /**
   * Claim exactly one claimable entitlement.
   *
   * A conditional UPDATE, not a read followed by a write: the row only moves out
   * of `granted` once, so two concurrent spins cannot both win. The TTL is part
   * of the predicate as well as of the sweep (TD-0004), so a spin inside the
   * sweep window is still refused.
   */
  async claimOne(playerId: string, now: Date): Promise<SpinEntitlement | null> {
    const tenantId = currentTenantId();
    const rows = await this.uow.tx.execute<{
      id: string;
      player_id: string;
      wheel_id: string;
      wheel_version: number;
      rule_id: string;
      server_seed: string;
      seed_hash: string;
      granted_at: Date;
      expires_at: Date;
    }>(sql`
      update gamification.spin_entitlement
         set state = 'consumed', consumed_at = ${now.toISOString()}::timestamptz
       where id = (
         select id from gamification.spin_entitlement
          where tenant_id = ${tenantId}
            and player_id = ${playerId}
            and state = 'granted'
            and expires_at > ${now.toISOString()}::timestamptz
          order by expires_at, id
          for update skip locked
          limit 1
       )
      returning id, player_id, wheel_id, wheel_version, rule_id, server_seed, seed_hash, granted_at, expires_at
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      tenantId,
      playerId: row.player_id,
      wheelId: row.wheel_id,
      wheelVersion: Number(row.wheel_version),
      ruleId: row.rule_id,
      state: 'consumed',
      serverSeed: row.server_seed,
      seedHash: row.seed_hash,
      grantedAt: row.granted_at,
      expiresAt: row.expires_at,
    };
  }

  async countClaimable(playerId: string, now: Date): Promise<number> {
    const rows = await this.uow.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(spinEntitlement)
      .where(
        and(
          scopedWhere(spinEntitlement, eq(spinEntitlement.playerId, playerId)),
          eq(spinEntitlement.state, 'granted'),
          sql`${spinEntitlement.expiresAt} > ${now.toISOString()}::timestamptz`,
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }

  async expireDue(now: Date): Promise<number> {
    const result = await this.uow.tx
      .update(spinEntitlement)
      .set({ state: 'expired' })
      .where(
        and(
          scopedWhere(spinEntitlement),
          eq(spinEntitlement.state, 'granted'),
          lte(spinEntitlement.expiresAt, now),
        ),
      )
      .returning({ id: spinEntitlement.id });
    return result.length;
  }
}
