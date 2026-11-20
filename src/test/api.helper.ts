import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { APP_CONFIG, loadConfig, type AppConfig } from '../platform/config/config';
import { CLOCK, FixedClock } from '../platform/clock/clock';
import { ProblemJsonFilter } from '../platform/http/problem-json.filter';
import { rawBodyJson } from '../platform/http/raw-body';
import { hmacHex } from '../platform/crypto/crypto';
import { createTestDb, type TestDb } from './db.helper';

export type TestApi = {
  app: INestApplication;
  db: TestDb;
  clock: FixedClock;
  config: AppConfig;
  close: () => Promise<void>;
};

/** The real composition, pointed at a database of this test file's own. */
export async function startTestApi(label: string, overrides: Record<string, string> = {}): Promise<TestApi> {
  const db = await createTestDb(label);
  const clock = new FixedClock(new Date('2026-11-20T12:00:00.000Z'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: db.url,
    PLAYER_TOKEN_SECRET: 'platform-player-token-secret-32ch',
    LOG_LEVEL: 'silent',
    ...overrides,
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();

  const app = moduleRef.createNestApplication({ bodyParser: false });
  app.use(rawBodyJson());
  app.useGlobalFilters(new ProblemJsonFilter());
  await app.init();

  return {
    app,
    db,
    clock,
    config,
    close: async () => {
      await app.close();
      await db.drop();
    },
  };
}

/** Sign a webhook exactly as an operator would. */
export function signed(body: unknown, keyId: string, secret: string, timestampSeconds: number) {
  const raw = JSON.stringify(body);
  return {
    raw,
    headers: {
      'content-type': 'application/json',
      'x-mio-key-id': keyId,
      'x-mio-timestamp': String(timestampSeconds),
      'x-mio-signature': hmacHex(secret, `${timestampSeconds}.${raw}`),
    },
  };
}
