import { bigserial, index, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const ingestion = pgSchema('ingestion');

export const envelope = ingestion.table(
  'envelope',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    operator: text('operator').notNull(),
    operatorEventId: text('operator_event_id'),
    raw: jsonb('raw').notNull(),
    outcome: text('outcome').notNull(),
    eventId: uuid('event_id'),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('envelope_tenant_idx').on(table.tenantId, table.receivedAt)],
);

export const dedup = ingestion.table(
  'dedup',
  {
    tenantId: text('tenant_id').notNull(),
    operatorEventId: text('operator_event_id').notNull(),
    eventId: uuid('event_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.operatorEventId] })],
);
