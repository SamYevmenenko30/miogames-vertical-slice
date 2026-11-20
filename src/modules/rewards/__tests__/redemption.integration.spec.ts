import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from '../../../test/api.helper';
import { IdentityFacade } from '../../identity';
import { LedgerFacade } from '../../ledger';
import { withTenant } from '../../../platform/db/tenant-context';

let api: TestApi;
let token: string;
let playerId: string;

const item = { price: 100, reward: { kind: 'free_spins', count: 50 }, name: '50 free spins' };

const putItem = (itemId: string, body: object = item, key = 'key-a.secret-a') =>
  request(api.app.getHttpServer())
    .put(`/v1/admin/store-items/${itemId}`)
    .set('authorization', `Bearer ${key}`)
    .send(body);

const redeem = (itemId: string, idempotencyKey: string | null, bearer = token) => {
  const req = request(api.app.getHttpServer()).post('/v1/redemptions').set('authorization', `Bearer ${bearer}`);
  if (idempotencyKey) req.set('idempotency-key', idempotencyKey);
  return req.send({ itemId });
};

const session = (externalPlayerId: string, key = 'key-a.secret-a') =>
  request(api.app.getHttpServer())
    .post('/v1/sessions')
    .set('authorization', `Bearer ${key}`)
    .send({ externalPlayerId });

beforeAll(async () => {
  api = await startTestApi('redemption');
  const identity = api.app.get(IdentityFacade);
  await identity.provisionTenant({ id: 'tenant-a', name: 'A', operator: 'casino-a', keyId: 'key-a', secret: 'secret-a' });
  await identity.provisionTenant({ id: 'tenant-b', name: 'B', operator: 'casino-b', keyId: 'key-b', secret: 'secret-b' });
});

afterAll(async () => {
  await api?.close();
});

beforeEach(async () => {
  await api.db.sql`truncate rewards.redemption, rewards.store_item, ledger.entry, ledger.balance, infra.outbox restart identity`;
  await api.db.sql`truncate identity.player_identity, identity.player cascade`;
  const created = await session('player-77');
  token = created.body.token;
  const rows = await api.db.sql`select player_id from identity.player_identity where external_player_id = 'player-77'`;
  playerId = rows[0]!.player_id as string;
  await putItem('spins-50');
  const ledger = api.app.get(LedgerFacade);
  await withTenant('tenant-a', async () =>
    ledger.credit({ playerId, coins: 500, reason: 'test.topup', idempotencyKey: 'topup' }),
  );
});

describe('rewards — the store', () => {
  it('S1 — an item is configured per tenant and listed to the player', async () => {
    const res = await request(api.app.getHttpServer()).get('/v1/store-items').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({ itemId: 'spins-50', price: 100, name: '50 free spins' }),
    ]);
  });

  it('S1 — an item with a non-positive price is refused', async () => {
    const res = await putItem('bad', { ...item, price: 0 });
    expect(res.status).toBe(422);
  });
});

describe('rewards — redeeming', () => {
  it('S2 — it debits the coins, records the intent and emits one event, in one transaction', async () => {
    const res = await redeem('spins-50', 'key-1');

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'pending_issuance' });
    expect(res.body.redemptionId).toMatch(/[0-9a-f-]{36}/);

    const balance = await api.db.sql`select coins from ledger.balance where player_id = ${playerId}`;
    expect(balance[0]!.coins).toBe(400);

    const outbox = await api.db.sql`select name, payload from infra.outbox`;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.name).toBe('rewards.redemption.requested');
  });

  it('S3 — a replay returns the first redemption and debits once', async () => {
    const first = await redeem('spins-50', 'key-2');
    const second = await redeem('spins-50', 'key-2');

    expect(second.status).toBe(200);
    expect(second.body.redemptionId).toBe(first.body.redemptionId);

    const balance = await api.db.sql`select coins from ledger.balance where player_id = ${playerId}`;
    expect(balance[0]!.coins).toBe(400);
    expect(await api.db.sql`select count(*)::int as n from infra.outbox`).toMatchObject([{ n: 1 }]);
    expect(
      await api.db.sql`select count(*)::int as n from ledger.entry where direction = 'debit'`,
    ).toMatchObject([{ n: 1 }]);
  });

  it('S4 — the same key from another player is a different redemption', async () => {
    const other = await session('player-88');
    const otherRows = await api.db.sql`select player_id from identity.player_identity where external_player_id = 'player-88'`;
    const ledger = api.app.get(LedgerFacade);
    await withTenant('tenant-a', async () =>
      ledger.credit({
        playerId: otherRows[0]!.player_id as string,
        coins: 500,
        reason: 'test.topup',
        idempotencyKey: 'topup-2',
      }),
    );

    const mine = await redeem('spins-50', 'shared-key');
    const theirs = await redeem('spins-50', 'shared-key', other.body.token);

    expect(theirs.status).toBe(202);
    expect(theirs.body.redemptionId).not.toBe(mine.body.redemptionId);
  });

  it('S5 — an insufficient balance is 422 and changes nothing', async () => {
    await putItem('expensive', { ...item, price: 10_000 });
    const res = await redeem('expensive', 'key-3');

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ balance: 500, requested: 10_000 });
    expect(await api.db.sql`select count(*)::int as n from rewards.redemption`).toMatchObject([{ n: 0 }]);
    expect(await api.db.sql`select count(*)::int as n from infra.outbox`).toMatchObject([{ n: 0 }]);
    const balance = await api.db.sql`select coins from ledger.balance where player_id = ${playerId}`;
    expect(balance[0]!.coins).toBe(500);
  });

  it('S6 — an unknown item is 404', async () => {
    const res = await redeem('no-such-item', 'key-4');
    expect(res.status).toBe(404);
  });

  it('S7 — a missing Idempotency-Key is 400 with a machine-readable type', async () => {
    const res = await redeem('spins-50', null);
    expect(res.status).toBe(400);
    expect(res.body.type).toContain('idempotency-key');
  });

  it('S8 — the status is readable, and another player cannot read it', async () => {
    const created = await redeem('spins-50', 'key-5');
    const mine = await request(api.app.getHttpServer())
      .get(`/v1/redemptions/${created.body.redemptionId}`)
      .set('authorization', `Bearer ${token}`);

    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ status: 'pending_issuance', itemId: 'spins-50', price: 100 });

    const other = await session('player-99');
    const theirs = await request(api.app.getHttpServer())
      .get(`/v1/redemptions/${created.body.redemptionId}`)
      .set('authorization', `Bearer ${other.body.token}`);
    expect(theirs.status).toBe(404);
  });

  it('S9 — five concurrent duplicates produce one redemption', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, async () => redeem('spins-50', 'key-6')));
    const ids = new Set(results.map((r) => r.body.redemptionId));

    expect(ids.size).toBe(1);
    expect(await api.db.sql`select count(*)::int as n from rewards.redemption`).toMatchObject([{ n: 1 }]);
    expect(
      await api.db.sql`select count(*)::int as n from ledger.entry where direction = 'debit'`,
    ).toMatchObject([{ n: 1 }]);
    expect(await api.db.sql`select count(*)::int as n from infra.outbox`).toMatchObject([{ n: 1 }]);
  });

  it('Q2 — a redemption carries its own price and payload, so removing the item does not change it', async () => {
    const created = await redeem('spins-50', 'key-7');
    await api.db.sql`delete from rewards.store_item where item_id = 'spins-50'`;

    const res = await request(api.app.getHttpServer())
      .get(`/v1/redemptions/${created.body.redemptionId}`)
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ price: 100, itemId: 'spins-50' });
  });
});
