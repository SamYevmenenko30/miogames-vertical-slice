import { eq } from 'drizzle-orm';
import { boolean, integer, pgSchema, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { scopedWhere } from '../../../../platform/db/scoped';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import type { RewardRuleRepositoryPort } from '../../application/ports';
import type { RewardRule } from '../../domain/reward-rule';

const gamification = pgSchema('gamification');

export const rewardRule = gamification.table(
  'reward_rule',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    minDepositMinor: integer('min_deposit_minor').notNull(),
    currency: text('currency').notNull(),
    wheelId: text('wheel_id').notNull(),
    spins: integer('spins').notNull(),
    ttlHours: integer('ttl_hours').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

export class RewardRuleRepository implements RewardRuleRepositoryPort {
  constructor(private readonly uow: UnitOfWork) {}

  async activeRules(): Promise<RewardRule[]> {
    const rows = await this.uow.tx
      .select()
      .from(rewardRule)
      .where(scopedWhere(rewardRule, eq(rewardRule.active, true)));
    return rows.map((row) => ({
      id: row.id,
      minDepositMinor: Number(row.minDepositMinor),
      currency: row.currency,
      wheelId: row.wheelId,
      spins: Number(row.spins),
      ttlHours: Number(row.ttlHours),
    }));
  }
}
