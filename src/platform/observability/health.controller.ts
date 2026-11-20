import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../db/database';
import { LOGGER, type Logger } from './logger';

/**
 * Health, and the schema version it is running against.
 *
 * It does NOT run migrations. A boot-time migration on a multi-replica deploy is
 * a race; the deploy applies them as its own step and this endpoint reports what
 * was applied, so a wrong answer is visible rather than silently corrected.
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Get('health')
  async health(@Res() res: Response): Promise<void> {
    try {
      const rows = await this.database.db.execute<{ version: string }>(
        sql`select version from infra.schema_migrations order by version desc limit 1`,
      );
      res.status(200).json({ ok: true, schemaVersion: rows[0]?.version ?? null, role: 'api' });
    } catch (error) {
      this.logger.error({ err: String(error) }, 'health check could not reach the database');
      res.status(503).json({ ok: false, schemaVersion: null, role: 'api' });
    }
  }
}
