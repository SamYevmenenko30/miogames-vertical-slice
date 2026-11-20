import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { desc } from 'drizzle-orm';
import { scopedWhere } from '../db/scoped';
import { withTenant } from '../db/tenant-context';
import { UnitOfWork } from '../db/unit-of-work';
import { UnauthorizedError } from '../http/errors';
import { auditLog } from './audit.schema';

/**
 * Reading the audit log back.
 *
 * It lives in `platform/audit` with the table it reads, and it authenticates
 * through a port rather than importing `identity` — platform may not import a
 * business module, and that rule is worth more than the convenience of calling
 * the facade directly here.
 */
export const OPERATOR_AUTHENTICATOR = Symbol('OperatorAuthenticator');

export interface OperatorAuthenticator {
  authenticate(keyId: string, secret: string): Promise<{ tenantId: string; keyId: string } | null>;
}

@Controller('v1/admin')
export class AdminAuditController {
  constructor(
    private readonly uow: UnitOfWork,
    @Inject(OPERATOR_AUTHENTICATOR) private readonly operators: OperatorAuthenticator,
  ) {}

  @Get('audit')
  async read(@Query('limit') limit: string | undefined, @Req() req: Request): Promise<{ entries: unknown[] }> {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+([^.\s]+)\.(.+)$/.exec(header.trim());
    if (!match) throw new UnauthorizedError('credentials.invalid', 'Operator API credentials are required.');
    const operator = await this.operators.authenticate(match[1]!, match[2]!);
    if (!operator) throw new UnauthorizedError('credentials.invalid', 'The credentials were not accepted.');

    const take = Math.min(Number(limit) > 0 ? Number(limit) : 50, 200);
    return withTenant(operator.tenantId, async () => {
      const rows = await this.uow.withTransaction(async () =>
        this.uow.tx.select().from(auditLog).where(scopedWhere(auditLog)).orderBy(desc(auditLog.id)).limit(take),
      );
      return {
        entries: rows.map((row) => ({
          action: row.action,
          actor: row.actor,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          data: row.data,
          recordedAt: row.recordedAt,
        })),
      };
    });
  }
}
