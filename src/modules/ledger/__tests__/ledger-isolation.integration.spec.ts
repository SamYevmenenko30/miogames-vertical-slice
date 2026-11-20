import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../../../platform/clock/clock';
import { createDatabase, type Database } from '../../../platform/db/database';
import { withTenant } from '../../../platform/db/tenant-context';
import { UnitOfWork } from '../../../platform/db/unit-of-work';
import { createTestDb, type TestDb } from '../../../test/db.helper';
import { LedgerRepository } from '../adapters/out/ledger.repository';
import { LedgerFacade } from '../application/ledger.facade';

let testDb: TestDb;
let database: Database;
let ledger: LedgerFacade;
const player = randomUUID();

beforeAll(async () => {
  testDb = await createTestDb('ledger-isolation');
  database = createDatabase({ url: testDb.url });
  const uow = new UnitOfWork(database);
  ledger = new LedgerFacade(uow, new LedgerRepository(uow), new FixedClock(new Date('2026-11-20T12:00:00.000Z')));
  await withTenant('tenant-a', async () =>
    ledger.credit({ playerId: player, coins: 100, reason: 'spin.prize', idempotencyKey: 'c1' }),
  );
});

afterAll(async () => {
  await database?.close();
  await testDb?.drop();
});

describe('ledger — tenant isolation', () => {
  it("S10 — tenant B sees zero for tenant A's player", async () => {
    expect(await withTenant('tenant-b', async () => ledger.balanceOf(player))).toBe(0);
    expect(await withTenant('tenant-a', async () => ledger.balanceOf(player))).toBe(100);
  });

  it("S10 — tenant B cannot debit tenant A's coins", async () => {
    await expect(
      withTenant('tenant-b', async () =>
        ledger.debit({ playerId: player, coins: 50, reason: 'theft', idempotencyKey: 'x' }),
      ),
    ).rejects.toThrowError(/insufficient/i);
    expect(await withTenant('tenant-a', async () => ledger.balanceOf(player))).toBe(100);
  });

  it('S10 — the same idempotency key in two tenants is two independent movements', async () => {
    await withTenant('tenant-b', async () =>
      ledger.credit({ playerId: player, coins: 7, reason: 'spin.prize', idempotencyKey: 'c1' }),
    );
    expect(await withTenant('tenant-b', async () => ledger.balanceOf(player))).toBe(7);
    expect(await withTenant('tenant-a', async () => ledger.balanceOf(player))).toBe(100);
  });

  it("S10 — tenant B's history does not include tenant A's entries", async () => {
    const history = await withTenant('tenant-b', async () => ledger.history(player, 50));
    expect(history.every((entry) => entry.coins === 7)).toBe(true);
  });
});
