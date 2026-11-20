import { integer, jsonb, pgSchema, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const gamification = pgSchema('gamification');

export const wheel = gamification.table(
  'wheel',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

export const wheelVersion = gamification.table(
  'wheel_version',
  {
    tenantId: text('tenant_id').notNull(),
    wheelId: text('wheel_id').notNull(),
    version: integer('version').notNull(),
    slices: jsonb('slices').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.wheelId, table.version] })],
);
