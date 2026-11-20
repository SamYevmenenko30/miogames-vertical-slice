import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../database';
import { applyMigrations } from '../migrator';
import { createTestDb, type TestDb } from '../../../test/db.helper';

/**
 * MIO-016 — the limits that keep a statement, a lock wait or an open transaction
 * from running without end.
 *
 * Every assertion here is taken from the SERVER (`pg_settings`, a real
 * cancellation, a real lock refusal), never from the options object we passed:
 * the defect this card closes was precisely that the application believed
 * something the database had never been told.
 */
let testDb: TestDb;
const pools: Database[] = [];

/** A pool on the OWNER role, so no policy or tenant context is in the way. */
const ownerPool = (timeouts: Parameters<typeof createDatabase>[0]['timeouts']): Database => {
  const pool = createDatabase({ url: testDb.url, max: 2, timeouts });
  pools.push(pool);
  return pool;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `pg_settings.setting` is the value in the GUC's base unit — milliseconds here —
 *  while `current_setting` formats it ('15s'), which is not a thing to assert on. */
const setting = async (pool: Database, name: string): Promise<string> => {
  const rows = await pool.sql<{ setting: string }[]>`select setting from pg_settings where name = ${name}`;
  return rows[0]?.setting ?? '(absent)';
};

beforeAll(async () => {
  testDb = await createTestDb('db-timeouts');
  await testDb.sql`insert into identity.tenant (id, name, operator) values ('tenant-a', 'A', 'casino-a')`;
});

afterAll(async () => {
  await Promise.allSettled(pools.map(async (pool) => pool.close()));
  await testDb?.drop();
});

describe('platform/db — timeouts', () => {
  it('S1 — the limits are in force on the connection, not just in our options', async () => {
    const pool = ownerPool({
      statementMs: 11_000,
      lockMs: 4000,
      idleInTransactionMs: 22_000,
      connectSeconds: 10,
    });
    expect(await setting(pool, 'statement_timeout')).toBe('11000');
    expect(await setting(pool, 'lock_timeout')).toBe('4000');
    expect(await setting(pool, 'idle_in_transaction_session_timeout')).toBe('22000');
  });

  it('S2 — a statement that outruns the limit is cancelled, and the pool survives it', async () => {
    const pool = ownerPool({ statementMs: 300, lockMs: 4000, idleInTransactionMs: 22_000, connectSeconds: 10 });

    const cancelled = await pool.sql`select pg_sleep(3)`.then(
      () => null,
      (error: unknown) => error as { code?: string },
    );
    expect(cancelled, 'a 3s sleep under a 300ms statement_timeout must not succeed').not.toBeNull();
    expect(cancelled?.code).toBe('57014');

    // The pool is still usable: a timeout that poisons the pool trades one outage
    // for a worse one.
    const after = await pool.sql<{ ok: number }[]>`select 1 as ok`;
    expect(after[0]?.ok).toBe(1);
  });

  it('S3 — a lock wait that outruns the limit fails instead of blocking, and the holder is unharmed', async () => {
    const waiter = ownerPool({ statementMs: 11_000, lockMs: 300, idleInTransactionMs: 22_000, connectSeconds: 10 });
    const holder = ownerPool({ statementMs: 11_000, lockMs: 11_000, idleInTransactionMs: 22_000, connectSeconds: 10 });

    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = holder.sql.begin(async (tx) => {
      await tx`select id from identity.tenant where id = 'tenant-a' for update`;
      await held;
      return 'held';
    });
    // Let the holder take the row before the waiter asks for it.
    await sleep(200);

    const started = Date.now();
    const refused = await waiter.sql`select id from identity.tenant where id = 'tenant-a' for update`.then(
      () => null,
      (error: unknown) => error as { code?: string },
    );
    const waited = Date.now() - started;

    expect(refused, 'the waiter must be refused, not queued behind the holder').not.toBeNull();
    expect(refused?.code).toBe('55P03');
    // The point of the limit: it gave up in its own time, not the holder's.
    expect(waited).toBeLessThan(3000);

    release();
    await expect(holding).resolves.toBe('held');
  });

  it('S4 — a transaction left idle past the limit is terminated and its write is lost', async () => {
    const pool = ownerPool({ statementMs: 11_000, lockMs: 4000, idleInTransactionMs: 400, connectSeconds: 10 });

    const outcome = await pool.sql
      .begin(async (tx) => {
        await tx`insert into identity.tenant (id, name, operator) values ('tenant-idle', 'idle', 'casino-a')`;
        // Idle inside the transaction, which is the state the limit is about.
        await sleep(1200);
        await tx`select 1`;
        return 'committed';
      })
      .then(
        () => 'committed',
        (error: unknown) => (error as { code?: string }).code ?? 'rejected',
      );

    expect(outcome, 'an idle transaction past the limit must not reach its commit').not.toBe('committed');

    const rows = await testDb.sql<{ id: string }[]>`select id from identity.tenant where id = 'tenant-idle'`;
    expect(rows).toHaveLength(0);
  });

  it('S5 — migrations are exempt: the migrator sets no limits at all', async () => {
    // The migrator does not return query results, so the migration RECORDS what
    // its own connection was given. The observation comes from inside the thing
    // under test, which is the only place it can come from.
    const dir = mkdtempSync(join(tmpdir(), 'mio-migrator-probe-'));
    writeFileSync(
      join(dir, '9001_timeout_probe.sql'),
      `create table infra.timeout_probe as
         select name, setting from pg_settings
         where name in ('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout');`,
    );

    const applied = await applyMigrations(testDb.url, dir);
    expect(applied).toContain('9001_timeout_probe.sql');

    const rows = await testDb.sql<{ name: string; setting: string }[]>`
      select name, setting from infra.timeout_probe order by name`;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.setting, `a migration must not run under ${row.name}`).toBe('0');
    }
  });
});
