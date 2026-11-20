import { bigserial, index, integer, jsonb, pgSchema, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const infra = pgSchema('infra');

export const outbox = infra.table(
  'outbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedBy: text('claimed_by'),
  },
  (table) => [index('outbox_pending_idx').on(table.nextAttemptAt, table.id)],
);

export const processedEvent = infra.table(
  'processed_event',
  {
    consumer: text('consumer').notNull(),
    eventId: text('event_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.consumer, table.eventId] })],
);
