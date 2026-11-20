import { boolean, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const rewards = pgSchema('rewards');

export const storeItem = rewards.table(
  'store_item',
  {
    tenantId: text('tenant_id').notNull(),
    itemId: text('item_id').notNull(),
    name: text('name').notNull(),
    price: integer('price').notNull(),
    reward: jsonb('reward').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.itemId] })],
);

export const redemption = rewards.table(
  'redemption',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    playerId: uuid('player_id').notNull(),
    itemId: text('item_id').notNull(),
    price: integer('price').notNull(),
    reward: jsonb('reward').notNull(),
    status: text('status').notNull().default('pending_issuance'),
    idempotencyKey: text('idempotency_key').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    externalRef: text('external_ref'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    /** The issuance LEASE: who is issuing this, and since when (database clock). */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedBy: text('claimed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('redemption_player_idx').on(table.tenantId, table.playerId, table.createdAt)],
);
