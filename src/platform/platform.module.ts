import { Global, Module } from '@nestjs/common';
import { AuditLog } from './audit/audit-log';
import { CLOCK, SystemClock, type Clock } from './clock/clock';
import { APP_CONFIG, loadConfig, type AppConfig } from './config/config';
import {
  createDatabase,
  DatabasePools,
  DATABASE,
  OWNER_DATABASE,
  type Database,
  type DatabaseTimeouts,
} from './db/database';
import { JobUnitOfWork, UnitOfWork } from './db/unit-of-work';
import { EVENT_BUS, OutboxEventBus } from './events/outbox';
import { createLogger, LOGGER } from './observability/logger';

/** One place that turns the four configured numbers into the driver's shape. */
const timeoutsFrom = (config: AppConfig): DatabaseTimeouts => ({
  statementMs: config.dbStatementTimeoutMs,
  lockMs: config.dbLockTimeoutMs,
  idleInTransactionMs: config.dbIdleInTransactionTimeoutMs,
  connectSeconds: config.dbConnectTimeoutSeconds,
});

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
      useFactory: (config: AppConfig) =>
        createDatabase({ url: config.databaseUrl, max: config.databasePoolMax, timeouts: timeoutsFrom(config) }),
    },
    { provide: UnitOfWork, inject: [DATABASE], useFactory: (database: Database) => new UnitOfWork(database) },
    {
      // The owner connection, for migrations and the one cross-tenant sweep.
      // Everything a request touches goes through the application role above.
      provide: OWNER_DATABASE,
      inject: [APP_CONFIG],
      // The same limits as the application pool (MIO-016 Q3): the sweep this pool
      // exists for is a bounded claim over expired leases, and if it ever cannot
      // finish inside the statement limit then the limit is not what is wrong.
      useFactory: (config: AppConfig) =>
        createDatabase({ url: config.databaseOwnerUrl, max: 2, timeouts: timeoutsFrom(config) }),
    },
    {
      provide: JobUnitOfWork,
      inject: [OWNER_DATABASE],
      useFactory: (database: Database) => new JobUnitOfWork(database),
    },
    {
      // Nothing injects this; it exists to carry the shutdown hook the two pools
      // cannot carry themselves. Nest instantiates every provider at init and
      // calls `onApplicationShutdown` on each, so being unreferenced is fine —
      // being a plain object, as the pools are, was not.
      provide: DatabasePools,
      inject: [DATABASE, OWNER_DATABASE],
      useFactory: (database: Database, owner: Database) => new DatabasePools([database, owner]),
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
