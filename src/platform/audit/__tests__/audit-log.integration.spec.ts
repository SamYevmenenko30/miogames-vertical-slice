import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../test/db.helper';
import { FixedClock } from '../../clock/clock';
import { createDatabase, type Database } from '../../db/database';
import { UnitOfWork } from '../../db/unit-of-work';
import { AuditLog } from '../audit-log';

let testDb: TestDb;
let database: Database;
let uow: UnitOfWork;
let audit: AuditLog;

beforeAll(async () => {
  testDb = await createTestDb('audit-log');
  database = createDatabase({ url: testDb.url });
  uow = new UnitOfWork(database);
  audit = new AuditLog(uow, new FixedClock(new Date('2026-11-20T12:00:00.000Z')));
});

afterAll(async () => {
  await database?.close();
  await testDb?.drop();
});

describe('platform/audit', () => {
  it('S17 — a recorded entry is readable with its actor, subject and payload', async () => {
    await uow.withTransaction(async () =>
      audit.record({
        tenantId: 'tenant-a',
        actor: 'admin:casino-a',
        action: 'wheel.version.created',
        subjectType: 'wheel',
        subjectId: 'wheel-1',
        data: { version: 2 },
      }),
    );

    const rows = await testDb.sql`select * from infra.audit_log where action = 'wheel.version.created'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe('admin:casino-a');
    expect(rows[0]!.data).toEqual({ version: 2 });
  });

  it('S17 — the database refuses an UPDATE of an audit row', async () => {
    await uow.withTransaction(async () =>
      audit.record({
        tenantId: 'tenant-a',
        actor: 'admin:casino-a',
        action: 'immutable.probe',
        subjectType: 'wheel',
        subjectId: 'wheel-1',
        data: {},
      }),
    );

    await expect(
      testDb.sql`update infra.audit_log set actor = 'tampered' where action = 'immutable.probe'`,
    ).rejects.toThrowError(/append-only|immutable/i);
  });

  it('S17 — the database refuses a DELETE of an audit row', async () => {
    await expect(testDb.sql`delete from infra.audit_log`).rejects.toThrowError(/append-only|immutable/i);
  });
});
