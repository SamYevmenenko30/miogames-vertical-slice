import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../test/db.helper';

let testDb: TestDb;
/** A connection as the APPLICATION role — not the owner, or RLS would not apply. */
let app: postgres.Sql;

const playerA = '11111111-1111-1111-1111-111111111111';
const playerB = '22222222-2222-2222-2222-222222222222';

/** Run a block with a transaction-local tenant, exactly as the unit of work does. */
const asTenant = async <T>(tenantId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
  app.begin(async (tx) => {
    if (tenantId !== null) await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;

beforeAll(async () => {
  testDb = await createTestDb('row-level-security');
  // State the dependency instead of tripping over it: without an application-role
  // URL, `postgres(undefined)` degrades into a connection error, and red-check
  // rightly refuses to call that "red" — it cannot tell a missing feature from a
  // missing database.
  expect(typeof testDb.appUrl, 'the test helper must expose an application-role URL').toBe('string');
  app = postgres(testDb.appUrl, { max: 2, onnotice: () => {} });

  // Seeded as the OWNER, which bypasses the policies — that is what makes the
  // assertions below about the application role meaningful.
  await testDb.sql`insert into identity.tenant (id, name, operator) values
    ('tenant-a', 'A', 'casino-a'), ('tenant-b', 'B', 'casino-b')`;
  await testDb.sql`insert into identity.player (id, tenant_id) values
    (${playerA}, 'tenant-a'), (${playerB}, 'tenant-b')`;
  await testDb.sql`insert into ledger.balance (tenant_id, player_id, coins) values
    ('tenant-a', ${playerA}, 100), ('tenant-b', ${playerB}, 500)`;
});

afterAll(async () => {
  await app?.end({ timeout: 5 });
  await testDb?.drop();
});

describe('platform/db — row-level security', () => {
  it('S1 — a bare SELECT returns only the current tenant rows', async () => {
    const rows = await asTenant('tenant-a', async (tx) => tx`select tenant_id, coins from ledger.balance`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenant_id).toBe('tenant-a');
  });

  it('S2 — with no tenant set, a tenant-owned table returns nothing', async () => {
    const rows = await asTenant(null, async (tx) => tx`select * from ledger.balance`);
    expect(rows).toHaveLength(0);
  });

  it('S3 — an INSERT for another tenant is refused', async () => {
    await expect(
      asTenant('tenant-a', async (tx) =>
        tx`insert into ledger.balance (tenant_id, player_id, coins) values ('tenant-b', ${playerB}, 1)`,
      ),
    ).rejects.toThrowError(/policy|permission/i);
  });

  it('S4 — an UPDATE cannot reach another tenant row, even by primary key', async () => {
    await asTenant('tenant-a', async (tx) => {
      const updated = await tx`
        update ledger.balance set coins = 0 where tenant_id = 'tenant-b' and player_id = ${playerB} returning *`;
      expect(updated).toHaveLength(0);
    });
    const check = await testDb.sql`select coins from ledger.balance where tenant_id = 'tenant-b'`;
    expect(Number(check[0]!.coins)).toBe(500);
  });

  it('S5 — the setting is transaction-local: the next transaction starts blind', async () => {
    await asTenant('tenant-a', async (tx) => {
      expect(await tx`select * from ledger.balance`).toHaveLength(1);
    });
    const rows = await asTenant(null, async (tx) => tx`select * from ledger.balance`);
    expect(rows).toHaveLength(0);
  });

  it('S6 — the application role cannot delete or truncate an append-only table', async () => {
    await expect(app`delete from ledger.entry`).rejects.toThrowError(/permission|denied/i);
    await expect(app`truncate infra.audit_log`).rejects.toThrowError(/permission|denied|owner/i);
  });

  it('S7 — every tenant-owned table has row-level security enabled and a policy', async () => {
    const tables = await testDb.sql<Array<{ schemaname: string; tablename: string; rowsecurity: boolean }>>`
      select n.nspname as schemaname, c.relname as tablename, c.relrowsecurity as rowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r'
         and n.nspname in ('identity', 'ingestion', 'gamification', 'ledger', 'rewards')
         and exists (
           select 1 from pg_attribute a
            where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
         )`;
    expect(tables.length).toBeGreaterThan(5);

    const policies = await testDb.sql<Array<{ schemaname: string; tablename: string }>>`
      select schemaname, tablename from pg_policies`;
    const withPolicy = new Set(policies.map((p) => `${p.schemaname}.${p.tablename}`));

    const missing = tables
      .filter((t) => !t.rowsecurity || !withPolicy.has(`${t.schemaname}.${t.tablename}`))
      .map((t) => `${t.schemaname}.${t.tablename}`);
    expect(missing).toEqual([]);
  });
});
