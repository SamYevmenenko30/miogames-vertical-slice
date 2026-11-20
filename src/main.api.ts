import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './platform/config/config';
import { ProblemJsonFilter } from './platform/http/problem-json.filter';
import { rawBodyJson } from './platform/http/raw-body';
import { LOGGER, type Logger } from './platform/observability/logger';

/** Composition root #1: the HTTP API. Migrations are NOT applied here. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = app.get<Logger>(LOGGER);

  app.use(rawBodyJson());
  app.useGlobalFilters(new ProblemJsonFilter(logger));
  app.enableShutdownHooks();

  await app.listen(config.port);
  logger.info({ port: config.port, env: config.nodeEnv }, 'api listening');
}

void bootstrap();
