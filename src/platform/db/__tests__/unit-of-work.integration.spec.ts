import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../test/db.helper';
import { auditLog } from '../../audit/audit.schema';
import { createDatabase, type Database } from '../database';
import { UnitOfWork } from '../unit-of-work';
import { currentTenantId, currentTenantIdOrNull, withTenant } from '../tenant-context';
import { scopedWhere } from '../scoped';

let testDb: TestDb;
let database: Database;
let uow: UnitOfWork;

beforeAll(async () => {
  testDb = await createTestDb('unit-of-work');
  // The OWNER on purpose: this file proves transaction semantics, including what
  // happens with NO tenant in context, which under row-level security would be
  // indistinguishable from an empty table.
  database = createDatabase({ url: testDb.url });
  uow = new UnitOfWork(database);
});

afterAll(async () => {
  await database?.close();
  await testDb?.drop();
});

const writeAudit = async (tenantId: string, action: string) =>
  uow.tx.insert(auditLog).values({
    tenantId,
    action,
    actor: 'test',
    subjectType: 'probe',
    subjectId: action,
    data: {},
  });

const countActions = async (action: string) => {
  const rows = await testDb.sql`select count(*)::int as n from infra.audit_log where action = ${action}`;
  return rows[0]!.n as number;
};

describe('platform/db — unit of work', () => {
  it('S4 — a nested withTransaction joins the outer transaction', async () => {
    const seen: boolean[] = [];
    await uow.withTransaction(async () => {
      const outer = uow.tx;
      await uow.withTransaction(async () => {
        seen.push(uow.tx === outer);
      });
    });
    expect(seen).toEqual([true]);
  });

  it('S4 — rolling back the outer transaction undoes work the inner one did', async () => {
    await expect(
      uow.withTransaction(async () => {
        await uow.withTransaction(async () => {
          await writeAudit('tenant-a', 'nested-rollback');
        });
        throw new Error('outer fails');
      }),
    ).rejects.toThrow('outer fails');
    expect(await countActions('nested-rollback')).toBe(0);
  });

  it('S5 — a throw inside a transaction rolls back every write in it', async () => {
    await expect(
      uow.withTransaction(async () => {
        await writeAudit('tenant-a', 'rollback-1');
        await writeAudit('tenant-a', 'rollback-2');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await countActions('rollback-1')).toBe(0);
    expect(await countActions('rollback-2')).toBe(0);
  });

  it('S5 — a transaction that returns commits its writes', async () => {
    await uow.withTransaction(async () => {
      await writeAudit('tenant-a', 'committed');
    });
    expect(await countActions('committed')).toBe(1);
  });

  it('S6 — obtaining the transactional client outside a unit of work throws', () => {
    expect(() => uow.tx).toThrowError(/unit of work/i);
  });

  it('S6 — the unit of work reports whether one is open', async () => {
    expect(uow.inTransaction()).toBe(false);
    await uow.withTransaction(async () => {
      expect(uow.inTransaction()).toBe(true);
    });
    expect(uow.inTransaction()).toBe(false);
  });
});

describe('platform/db — tenant context', () => {
  it('S7 — currentTenantId throws outside a tenant scope', () => {
    expect(() => currentTenantId()).toThrowError(/tenant/i);
    expect(currentTenantIdOrNull()).toBeNull();
  });

  it('S7 — the tenant survives an await inside the scope', async () => {
    await withTenant('tenant-a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(currentTenantId()).toBe('tenant-a');
    });
    expect(currentTenantIdOrNull()).toBeNull();
  });

  it('S7 — concurrent scopes do not leak into each other', async () => {
    const seen: string[] = [];
    await Promise.all([
      withTenant('tenant-a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        seen.push(currentTenantId());
      }),
      withTenant('tenant-b', async () => {
        seen.push(currentTenantId());
      }),
    ]);
    expect(seen.sort()).toEqual(['tenant-a', 'tenant-b']);
  });
});

describe('platform/db — scoped queries', () => {
  it('S8 — a scoped select returns only the current tenant rows', async () => {
    await uow.withTransaction(async () => {
      await writeAudit('tenant-a', 'scoped-probe');
      await writeAudit('tenant-b', 'scoped-probe');
    });

    const forA = await withTenant('tenant-a', async () =>
      uow.withTransaction(async () => uow.tx.select().from(auditLog).where(scopedWhere(auditLog))),
    );
    expect(forA.length).toBeGreaterThan(0);
    expect(forA.every((row) => row.tenantId === 'tenant-a')).toBe(true);
  });

  it('S8 — building a scoped predicate without a tenant in context throws', () => {
    expect(() => scopedWhere(auditLog)).toThrowError(/tenant/i);
  });
});
