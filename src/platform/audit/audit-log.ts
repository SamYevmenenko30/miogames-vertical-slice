import type { Clock } from '../clock/clock';
import type { UnitOfWork } from '../db/unit-of-work';
import { auditLog } from './audit.schema';

export type AuditEntry = {
  tenantId: string;
  actor: string;
  action: string;
  subjectType: string;
  subjectId: string;
  data?: Record<string, unknown>;
};

/**
 * Append-only by database constraint, not by convention (ADR-0005, S17): a
 * trigger refuses UPDATE and DELETE on infra.audit_log. An audit log the
 * application can rewrite is not an audit log.
 *
 * Writes join the caller's transaction, so an audited change and its audit row
 * commit together or not at all.
 */
export class AuditLog {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.uow.tx.insert(auditLog).values({
      tenantId: entry.tenantId,
      actor: entry.actor,
      action: entry.action,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      data: entry.data ?? {},
      recordedAt: this.clock.now(),
    });
  }
}
