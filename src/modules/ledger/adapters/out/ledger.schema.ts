import { bigserial, check, index, integer, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const ledger = pgSchema('ledger');

export const entry = ledger.table(
  'entry',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    playerId: uuid('player_id').notNull(),
    direction: text('direction').notNull(),
    coins: integer('coins').notNull(),
    reason: text('reason').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('entry_player_idx').on(table.tenantId, table.playerId, table.id)],
);

export const balance = ledger.table(
  'balance',
  {
    tenantId: text('tenant_id').notNull(),
    playerId: uuid('player_id').notNull(),
    coins: integer('coins').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.playerId] }),
    check('balance_never_negative', sql`${table.coins} >= 0`),
  ],
);
