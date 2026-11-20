import { boolean, index, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const identity = pgSchema('identity');

export const tenant = identity.table('tenant', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  operator: text('operator').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantApiKey = identity.table(
  'tenant_api_key',
  {
    keyId: text('key_id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    secretDigest: text('secret_digest').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('tenant_api_key_tenant_idx').on(table.tenantId)],
);

export const player = identity.table(
  'player',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('player_tenant_idx').on(table.tenantId)],
);

export const playerIdentity = identity.table(
  'player_identity',
  {
    tenantId: text('tenant_id').notNull(),
    externalPlayerId: text('external_player_id').notNull(),
    playerId: uuid('player_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.externalPlayerId] }),
    index('player_identity_player_idx').on(table.playerId),
  ],
);
