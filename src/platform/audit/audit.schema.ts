import { bigserial, index, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

export const infra = pgSchema('infra');

export const auditLog = infra.table(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    data: jsonb('data').notNull().default({}),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_log_tenant_idx').on(table.tenantId, table.recordedAt)],
);
