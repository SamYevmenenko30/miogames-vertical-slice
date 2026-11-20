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

  it('S9 — the partition root is readable before a tenant is known, and scoped once it is', async () => {
    // Resolving "which tenant is this key" is the step that ESTABLISHES the
    // tenant, so it cannot require one: with nothing in context the lookup has to
    // work, and once a tenant is set it must see only that tenant's keys. Both
    // halves matter — the first is what every request depends on, and the second
    // is why identity's own isolation test runs as the owner (it asserts that
    // `authenticate` ignores the ambient tenant, which this policy would mask).
    await testDb.sql`insert into identity.tenant_api_key (key_id, tenant_id, secret_digest) values
      ('key-a', 'tenant-a', 'digest-a'), ('key-b', 'tenant-b', 'digest-b')`;

    const blind = await asTenant(null, async (tx) => tx`select key_id from identity.tenant_api_key order by key_id`);
    expect(blind.map((row) => row.key_id)).toEqual(['key-a', 'key-b']);

    const scoped = await asTenant('tenant-a', async (tx) => tx`select key_id from identity.tenant_api_key order by key_id`);
    expect(scoped.map((row) => row.key_id)).toEqual(['key-a']);
  });

  it('S7 — every tenant-owned table in EVERY schema has row-level security and a policy', async () => {
    // The census is over the whole catalogue, not a list of schemas written down
    // here. A hardcoded schema list cannot see a NEW module's schema, which is
    // exactly how an ungoverned tenant-owned table got past this test: grants for
    // the application role, no policy, every tenant's rows visible to every
    // tenant, and the suite green (adversarial review, S2).
    const tables = await testDb.sql<Array<{ schemaname: string; tablename: string; rowsecurity: boolean }>>`
      select n.nspname as schemaname, c.relname as tablename, c.relrowsecurity as rowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r'
         and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
         and n.nspname not like 'pg_temp%'
         and n.nspname not like 'pg_toast_temp%'
         and exists (
           select 1 from pg_attribute a
            where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
         )`;
    expect(tables.length).toBeGreaterThan(5);

    // The ONLY table that carries a tenant id and deliberately has no policy: the
    // relay reads it across tenants by design (MIO-011 Q2). `infra.processed_event`
    // is often named beside it but has no `tenant_id` column at all, so it is not
    // tenant-owned and never enters this census — writing it down as an exception
    // here is what made that clear. Naming the exceptions means a SECOND one
    // cannot appear without this line changing, which a reviewer sees in the diff.
    const documentedExceptions = ['infra.outbox'];

    const policies = await testDb.sql<Array<{ schemaname: string; tablename: string }>>`
      select schemaname, tablename from pg_policies`;
    const withPolicy = new Set(policies.map((p) => `${p.schemaname}.${p.tablename}`));

    const governed = (t: { schemaname: string; tablename: string; rowsecurity: boolean }) =>
      t.rowsecurity && withPolicy.has(`${t.schemaname}.${t.tablename}`);

    const missing = tables
      .filter((t) => !documentedExceptions.includes(`${t.schemaname}.${t.tablename}`))
      .filter((t) => !governed(t))
      .map((t) => `${t.schemaname}.${t.tablename}`);
    expect(missing, 'a tenant-owned table with no row-level security policy').toEqual([]);

    // And the exceptions are exactly the documented two — an exception that has
    // quietly gained a policy, or one that no longer exists, should be noticed.
    const actualExceptions = tables
      .filter((t) => !governed(t))
      .map((t) => `${t.schemaname}.${t.tablename}`)
      .sort();
    expect(actualExceptions).toEqual([...documentedExceptions].sort());
  });

});
