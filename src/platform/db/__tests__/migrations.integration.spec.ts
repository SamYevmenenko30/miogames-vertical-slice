import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../migrator';

const base = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? 'postgres://mio:mio@localhost:5440/mio';
const name = `mio_test_migrations_${randomUUID().slice(0, 8)}`;
let url: string;

beforeAll(async () => {
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database "${name}"`);
  await admin.end({ timeout: 5 });
  const parsed = new URL(base);
  parsed.pathname = `/${name}`;
  url = parsed.toString();
});

afterAll(async () => {
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.end({ timeout: 5 });
});

describe('platform/db — migrator', () => {
  it('S18 — applies every pending migration in filename order, and records them', async () => {
    const applied = await applyMigrations(url);
    expect(applied.length).toBeGreaterThan(0);
    expect([...applied].sort()).toEqual(applied);

    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const rows = await sql`select version from infra.schema_migrations order by version`;
      expect(rows.map((r) => r.version)).toEqual(applied);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('S18 — a second run applies nothing', async () => {
    await applyMigrations(url);
    const again = await applyMigrations(url);
    expect(again).toEqual([]);
  });
});
