import 'reflect-metadata';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { DepositObservedConsumer } from './modules/gamification/gamification.module';
import { IssuanceWorker } from './modules/rewards';
import { IssueRedemptionConsumer } from './modules/rewards/rewards.module';
import { CLOCK, type Clock } from './platform/clock/clock';
import { APP_CONFIG, type AppConfig } from './platform/config/config';
import { DATABASE, type Database } from './platform/db/database';
import { UnitOfWork } from './platform/db/unit-of-work';
import { OutboxRelay } from './platform/events/relay';
import { LOGGER, type Logger } from './platform/observability/logger';
import { WorkerModule } from './worker.module';

/**
 * Composition root #2: the outbox relay, the event consumers and the issuance
 * retry sweep.
 *
 * A separate process from the API on purpose: a blocked outbound call to an
 * operator must never tie up a player's request. It is the first thing
 * architecture/README §6 says we would extract.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn'] });
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = app.get<Logger>(LOGGER);
  const clock = app.get<Clock>(CLOCK);

  const relay = new OutboxRelay({
    uow: app.get(UnitOfWork),
    database: app.get<Database>(DATABASE),
    handlers: [app.get(DepositObservedConsumer), app.get(IssueRedemptionConsumer)],
    clock,
    logger,
    batchSize: config.outboxBatchSize,
    claimTimeoutMs: config.outboxClaimTimeoutMs,
    pollMs: config.outboxPollMs,
  });
  relay.start();

  const issuance = app.get(IssuanceWorker);
  const retrySweep = setInterval(() => {
    void issuance.runDueRetries().catch((error: unknown) => {
      logger.error({ err: String(error) }, 'issuance retry sweep failed');
    });
  }, config.outboxPollMs * 4);

  // Health, so a container orchestrator has something to ask.
  const health = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, role: 'worker' }));
  });
  health.listen(config.workerHealthPort);

  const shutdown = async () => {
    clearInterval(retrySweep);
    await relay.stop();
    health.close();
    await app.close();
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  logger.info({ healthPort: config.workerHealthPort, pollMs: config.outboxPollMs }, 'worker running');
}

void bootstrap();
