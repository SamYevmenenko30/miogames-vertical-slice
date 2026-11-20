import { Global, Module } from '@nestjs/common';
import { AuditLog } from './audit/audit-log';
import { CLOCK, SystemClock, type Clock } from './clock/clock';
import { APP_CONFIG, loadConfig, type AppConfig } from './config/config';
import { createDatabase, DATABASE, OWNER_DATABASE, type Database } from './db/database';
import { JobUnitOfWork, UnitOfWork } from './db/unit-of-work';
import { EVENT_BUS, OutboxEventBus } from './events/outbox';
import { createLogger, LOGGER } from './observability/logger';

/**
 * One transaction model, one error shape, one way to emit an event — provided
 * once, globally. Platform imports no business module; the linter enforces it.
 */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    { provide: CLOCK, useClass: SystemClock },
    { provide: LOGGER, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createLogger(config.logLevel) },
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createDatabase({ url: config.databaseUrl, max: config.databasePoolMax }),
    },
    { provide: UnitOfWork, inject: [DATABASE], useFactory: (database: Database) => new UnitOfWork(database) },
    {
      // The owner connection, for migrations and the one cross-tenant sweep.
      // Everything a request touches goes through the application role above.
      provide: OWNER_DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createDatabase({ url: config.databaseOwnerUrl, max: 2 }),
    },
    {
      provide: JobUnitOfWork,
      inject: [OWNER_DATABASE],
      useFactory: (database: Database) => new JobUnitOfWork(database),
    },
    {
      provide: EVENT_BUS,
      inject: [UnitOfWork, CLOCK],
      useFactory: (uow: UnitOfWork, clock: Clock) => new OutboxEventBus(uow, clock),
    },
    {
      provide: AuditLog,
      inject: [UnitOfWork, CLOCK],
      useFactory: (uow: UnitOfWork, clock: Clock) => new AuditLog(uow, clock),
    },
  ],
  exports: [APP_CONFIG, CLOCK, LOGGER, DATABASE, OWNER_DATABASE, UnitOfWork, JobUnitOfWork, EVENT_BUS, AuditLog],
})
export class PlatformModule {}
