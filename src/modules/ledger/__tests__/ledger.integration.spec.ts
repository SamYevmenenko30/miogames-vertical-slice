import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../../platform/clock/clock';
import { createDatabase, type Database } from '../../../platform/db/database';
import { withTenant } from '../../../platform/db/tenant-context';
import { UnitOfWork } from '../../../platform/db/unit-of-work';
import { createTestDb, type TestDb } from '../../../test/db.helper';
import { LedgerRepository } from '../adapters/out/ledger.repository';
import { LedgerFacade } from '../application/ledger.facade';

let testDb: TestDb;
let database: Database;
let uow: UnitOfWork;
let ledger: LedgerFacade;
let player: string;

const asA = <T>(fn: () => Promise<T>) => withTenant('tenant-a', fn);

beforeAll(async () => {
  testDb = await createTestDb('ledger');
  database = createDatabase({ url: testDb.url });
  uow = new UnitOfWork(database);
  ledger = new LedgerFacade(uow, new LedgerRepository(uow), new FixedClock(new Date('2026-11-20T12:00:00.000Z')));
});

afterAll(async () => {
  await database?.close();
  await testDb?.drop();
});

beforeEach(async () => {
  await testDb.sql`truncate ledger.entry, ledger.balance restart identity`;
  player = randomUUID();
});

describe('ledger — movements', () => {
  it('S1 — a credit raises the balance and leaves an entry', async () => {
    const entry = await asA(async () =>
      ledger.credit({ playerId: player, coins: 100, reason: 'spin.prize', idempotencyKey: 'spin:1' }),
    );
    expect(entry).toMatchObject({ direction: 'credit', coins: 100, reason: 'spin.prize' });
    expect(await asA(async () => ledger.balanceOf(player))).toBe(100);

    const entries = await testDb.sql`select * from ledger.entry`;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.idempotency_key).toBe('spin:1');
  });

  it('S2 — a debit lowers it', async () => {
    await asA(async () => ledger.credit({ playerId: player, coins: 100, reason: 'spin.prize', idempotencyKey: 'c1' }));
    await asA(async () => ledger.debit({ playerId: player, coins: 40, reason: 'redemption', idempotencyKey: 'd1' }));
    expect(await asA(async () => ledger.balanceOf(player))).toBe(60);
    expect(await testDb.sql`select count(*)::int as n from ledger.entry`).toMatchObject([{ n: 2 }]);
  });

  it('S3 — a debit beyond the balance is refused and changes nothing', async () => {
    await asA(async () => ledger.credit({ playerId: player, coins: 100, reason: 'spin.prize', idempotencyKey: 'c1' }));
    await expect(
      asA(async () => ledger.debit({ playerId: player, coins: 150, reason: 'redemption', idempotencyKey: 'd1' })),
    ).rejects.toThrowError(/insufficient/i);

    expect(await asA(async () => ledger.balanceOf(player))).toBe(100);
    expect(await testDb.sql`select count(*)::int as n from ledger.entry`).toMatchObject([{ n: 1 }]);
  });

  it('S3 — the refusal carries the balance and the amount, so a caller can explain it', async () => {
    await asA(async () => ledger.credit({ playerId: player, coins: 10, reason: 'spin.prize', idempotencyKey: 'c1' }));
    await asA(async () => {
      try {
        await ledger.debit({ playerId: player, coins: 50, reason: 'redemption', idempotencyKey: 'd1' });
        throw new Error('should have refused');
      } catch (error) {
        expect((error as { extensions?: Record<string, unknown> }).extensions).toMatchObject({
          balance: 10,
          requested: 50,
        });
      }
    });
  });

  it('S3 — a debit of exactly the balance succeeds and leaves zero', async () => {
    // The boundary of the one comparison that decides whether a purchase is
    // affordable. Nothing used to spend a player's whole balance, so turning
    // `balance < coins` into `balance <= coins` — which refuses a player who has
    // exactly enough — left the entire suite green.
    await asA(async () => ledger.credit({ playerId: player, coins: 100, reason: 'spin.prize', idempotencyKey: 'c1' }));
    const entry = await asA(async () =>
      ledger.debit({ playerId: player, coins: 100, reason: 'redemption', idempotencyKey: 'd1' }),
    );
    expect(entry).toMatchObject({ direction: 'debit', coins: 100 });
    expect(await asA(async () => ledger.balanceOf(player))).toBe(0);
  });

  it('S4 — the database refuses a negative balance on a direct update', async () => {
    await asA(async () => ledger.credit({ playerId: player, coins: 10, reason: 'spin.prize', idempotencyKey: 'c1' }));
    await expect(
      testDb.sql`update ledger.balance set coins = -1 where player_id = ${player}`,
    ).rejects.toThrowError(/check|constraint/i);
  });

  it('S5 — a replayed credit moves nothing twice', async () => {
    const first = await asA(async () =>
      ledger.credit({ playerId: player, coins: 100, reason: 'spin.prize', idempotencyKey: 'spin:7' }),
    );
    const again = await asA(async () =>
      ledger.credit({ playerId: player, coins: 100, reason: 'spin.prize', idempotencyKey: 'spin:7' }),
    );

    expect(again.id).toBe(first.id);
    expect(await asA(async () => ledger.balanceOf(player))).toBe(100);
    expect(await testDb.sql`select count(*)::int as n from ledger.entry`).toMatchObject([{ n: 1 }]);
  });

  it('S5 — a replayed debit moves nothing twice', async () => {
    await asA(async () => ledger.credit({ playerId: player, coins: 100, reason: 'spin.prize', idempotencyKey: 'c1' }));
    const first = await asA(async () =>
      ledger.debit({ playerId: player, coins: 30, reason: 'redemption', idempotencyKey: 'redemption:9' }),
    );
    const again = await asA(async () =>
      ledger.debit({ playerId: player, coins: 30, reason: 'redemption', idempotencyKey: 'redemption:9' }),
    );

    expect(again.id).toBe(first.id);
    expect(await asA(async () => ledger.balanceOf(player))).toBe(70);
  });

  it('S6 — two concurrent debits of 60 against 100: one succeeds, the balance ends at 40', async () => {
    await asA(async () => ledger.credit({ playerId: player, coins: 100, reason: 'spin.prize', idempotencyKey: 'c1' }));

    const results = await Promise.allSettled([
      asA(async () => ledger.debit({ playerId: player, coins: 60, reason: 'redemption', idempotencyKey: 'd-a' })),
      asA(async () => ledger.debit({ playerId: player, coins: 60, reason: 'redemption', idempotencyKey: 'd-b' })),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    // WHICH refusal matters, not just that one happened. `SELECT … FOR UPDATE` is
    // what makes the loser read the WINNER's balance and get the friendly 422;
    // without it the loser passes the application check on a stale read and is
    // refused by the CHECK constraint instead, which reaches the player as a 500.
    // The money is safe either way (ADR-0005) — the answer is not.
    expect(String(rejected[0]!.reason)).toMatch(/insufficient/i);
    expect(await asA(async () => ledger.balanceOf(player))).toBe(40);
    expect(await testDb.sql`select count(*)::int as n from ledger.entry`).toMatchObject([{ n: 2 }]);
  });

  it('S6 — the balance row is held for the whole transaction: a second mover waits for the first', async () => {
    // S6 above proves the OUTCOME of two concurrent debits, but it proves it with
    // or without the lock: when the loser happens to read after the winner has
    // committed it refuses politely all by itself. Whether `FOR UPDATE` is there
    // is a question about BLOCKING, so this asserts blocking directly — two
    // movements on their own connections, the second cannot have the row while
    // the first still holds it.
    await asA(async () => ledger.credit({ playerId: player, coins: 100, reason: 'spin.prize', idempotencyKey: 'c1' }));

    const uowA = new UnitOfWork(database);
    const uowB = new UnitOfWork(database);
    const repoA = new LedgerRepository(uowA);
    const repoB = new LedgerRepository(uowB);

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondGotTheRow = false;

    const first = asA(async () =>
      uowA.withTransaction(async () => {
        await repoA.lockBalance(player);
        await held;
      }),
    );
    const second = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return asA(async () =>
        uowB.withTransaction(async () => {
          await repoB.lockBalance(player);
          secondGotTheRow = true;
        }),
      );
    })();

    // `finally`, because the held transaction has to be let go even when the
    // assertion below fails: leaving it open holds a pooled connection and every
    // later test in this file waits out its timeout instead of reporting its own
    // result. (It did, the first time this was written.)
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(secondGotTheRow, 'the second mover read the balance while the first still held it').toBe(false);
    } finally {
      release();
      await Promise.allSettled([first, second]);
    }
    expect(secondGotTheRow).toBe(true);
  });

  it('S7 — entries are append-only', async () => {
    await asA(async () => ledger.credit({ playerId: player, coins: 10, reason: 'spin.prize', idempotencyKey: 'c1' }));
    await expect(testDb.sql`update ledger.entry set coins = 99`).rejects.toThrowError(/append-only/i);
    await expect(testDb.sql`delete from ledger.entry`).rejects.toThrowError(/append-only/i);
  });

  it('S8 — an unknown player has a balance of zero, and asking creates nothing', async () => {
    expect(await asA(async () => ledger.balanceOf(randomUUID()))).toBe(0);
    expect(await testDb.sql`select count(*)::int as n from ledger.balance`).toMatchObject([{ n: 0 }]);
  });

  it('S9 — the history is newest first and only this player', async () => {
    const other = randomUUID();
    await asA(async () => ledger.credit({ playerId: player, coins: 10, reason: 'one', idempotencyKey: 'k1' }));
    await asA(async () => ledger.credit({ playerId: player, coins: 20, reason: 'two', idempotencyKey: 'k2' }));
    await asA(async () => ledger.credit({ playerId: other, coins: 30, reason: 'three', idempotencyKey: 'k3' }));

    const history = await asA(async () => ledger.history(player, 10));
    expect(history.map((e) => e.reason)).toEqual(['two', 'one']);
  });
});
