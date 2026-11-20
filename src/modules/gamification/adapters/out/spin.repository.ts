import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { currentTenantId } from '../../../../platform/db/tenant-context';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import type { RecordedSpin, SpinRepositoryPort } from '../../application/ports';

const gamification = pgSchema('gamification');

export const spin = gamification.table('spin', {
  id: uuid('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  playerId: uuid('player_id').notNull(),
  entitlementId: uuid('entitlement_id').notNull(),
  wheelId: text('wheel_id').notNull(),
  wheelVersion: integer('wheel_version').notNull(),
  serverSeed: text('server_seed').notNull(),
  seedHash: text('seed_hash').notNull(),
  sliceId: text('slice_id').notNull(),
  prize: jsonb('prize').notNull(),
  coinsCredited: integer('coins_credited').notNull().default(0),
  spunAt: timestamp('spun_at', { withTimezone: true }).notNull(),
});

export class SpinRepository implements SpinRepositoryPort {
  constructor(private readonly uow: UnitOfWork) {}

  async record(entry: RecordedSpin): Promise<void> {
    await this.uow.tx.insert(spin).values({ ...entry, tenantId: currentTenantId() });
  }
}
