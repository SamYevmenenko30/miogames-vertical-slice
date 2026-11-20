import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { applyMigrations } from '../platform/db/migrator';

/**
 * One database per integration test FILE.
 *
 * Two reasons, both learned the hard way on a larger project: a shared test
 * database turns an unrelated file's crash into your flake, and a half-applied
 * migration in a shared database produces failures that look like application
 * bugs for hours. So: create, migrate, hand it over, drop.
 */
export type TestDb = {
  url: string;
  sql: postgres.Sql;
  drop: () => Promise<void>;
};

function adminUrl(): string {
  const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? 'postgres://mio:mio@localhost:5440/mio';
  const parsed = new URL(url);
  // Guard, not politeness: this helper DROPs databases. It may only ever point at
  // the local dev server, and the name it creates must carry `_test`.
  const port = parsed.port || '5432';
  if (port !== '5440' && process.env.CI !== '1' && !process.env.MIO_ALLOW_TEST_DB_PORT) {
    throw new Error(
      `refusing to create test databases on port ${port}: the dev server is 5440. ` +
        'Set MIO_ALLOW_TEST_DB_PORT=1 only if you are certain.',
    );
  }
  return url;
}

export async function createTestDb(label: string): Promise<TestDb> {
  const base = new URL(adminUrl());
  const name = `mio_test_${label.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${randomUUID().slice(0, 8)}`;
  if (!name.includes('_test')) throw new Error(`a test database name must contain "_test": ${name}`);

  const admin = postgres(base.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${name}"`);
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const url = new URL(base.toString());
  url.pathname = `/${name}`;
  await applyMigrations(url.toString());

  const sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  return {
    url: url.toString(),
    sql,
    drop: async () => {
      await sql.end({ timeout: 5 });
      const a = postgres(base.toString(), { max: 1, onnotice: () => {} });
      try {
        await a.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await a.end({ timeout: 5 });
      }
    },
  };
}
