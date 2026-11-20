import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../../platform/db/tenant-context';
import { createCasinoMock } from '../../../mocks/casino-platform/app';
import { startTestApi, type TestApi } from '../../../test/api.helper';
import { IdentityFacade } from '../../identity';
import { LedgerFacade } from '../../ledger';
import { IssueRedemptionConsumer } from '../adapters/in/issue-redemption.consumer';
import { IssuanceWorker } from '../application/issuance.worker';

let api: TestApi;
let mock: Server;
let mockUrl: string;
let tokens: Record<string, string> = {};
let players: Record<string, string> = {};

const operatorKeys = { 'tenant-a': 'key-a.secret-a', 'tenant-b': 'key-b.secret-b' } as const;

const session = async (tenant: keyof typeof operatorKeys, external: string) => {
  const res = await request(api.app.getHttpServer())
    .post('/v1/sessions')
    .set('authorization', `Bearer ${operatorKeys[tenant]}`)
    .send({ externalPlayerId: external });
  const rows = await api.db.sql`
    select player_id from identity.player_identity where tenant_id = ${tenant} and external_player_id = ${external}`;
  tokens[tenant] = res.body.token;
  players[tenant] = rows[0]!.player_id as string;
};

const topUp = async (tenant: keyof typeof operatorKeys, coins: number) => {
  const ledger = api.app.get(LedgerFacade);
  await withTenant(tenant, async () =>
    ledger.credit({ playerId: players[tenant]!, coins, reason: 'test.topup', idempotencyKey: `topup-${tenant}` }),
  );
};

const redeem = async (tenant: keyof typeof operatorKeys, key: string) => {
  const res = await request(api.app.getHttpServer())
    .post('/v1/redemptions')
    .set('authorization', `Bearer ${tokens[tenant]}`)
    .set('idempotency-key', key)
    .send({ itemId: 'spins-50' });
  expect(res.status).toBe(202);
  return res.body.redemptionId as string;
};

const statusOf = async (tenant: keyof typeof operatorKeys, id: string) => {
  const res = await request(api.app.getHttpServer())
    .get(`/v1/redemptions/${id}`)
    .set('authorization', `Bearer ${tokens[tenant]}`);
  return res.body as { status: string; attempts: number; lastError: string | null; externalRef: string | null };
};

const balance = async (tenant: keyof typeof operatorKeys) => {
  const rows = await api.db.sql`
    select coins from ledger.balance where tenant_id = ${tenant} and player_id = ${players[tenant]}`;
  return Number(rows[0]?.coins ?? 0);
};

/** Relay the outbox once, then let the issuance worker run its due retries. */
const drain = async () => {
  const consumer = api.app.get(IssueRedemptionConsumer);
  const rows = await api.db.sql`
    select id, tenant_id, name, aggregate_type, aggregate_id, payload, occurred_at
      from infra.outbox where published_at is null and name = 'rewards.redemption.requested' order by id`;
  for (const row of rows) {
    await consumer.consume({
      id: String(row.id),
      name: row.name as string,
      tenantId: row.tenant_id as string,
      aggregateType: row.aggregate_type as string,
      aggregateId: row.aggregate_id as string,
      payload: row.payload as Record<string, unknown>,
      occurredAt: row.occurred_at as Date,
    });
    await api.db.sql`update infra.outbox set published_at = now() where id = ${row.id}`;
  }
  await api.app.get(IssuanceWorker).runDueRetries();
};

beforeAll(async () => {
  mock = createCasinoMock().listen(0);
  const address = mock.address();
  mockUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  api = await startTestApi('issuance', {
    CASINO_MOCK_BASE_URL: mockUrl,
    ISSUANCE_TIMEOUT_MS: '300',
    ISSUANCE_MAX_ATTEMPTS: '3',
    ISSUANCE_BASE_BACKOFF_MS: '1',
  });
  const identity = api.app.get(IdentityFacade);
  await identity.provisionTenant({ id: 'tenant-a', name: 'A', operator: 'casino-a', keyId: 'key-a', secret: 'secret-a' });
  await identity.provisionTenant({ id: 'tenant-b', name: 'B', operator: 'casino-b', keyId: 'key-b', secret: 'secret-b' });
});

afterAll(async () => {
  await api?.close();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
});

beforeEach(async () => {
  await api.db.sql`truncate rewards.redemption, rewards.store_item, ledger.entry, ledger.balance, infra.outbox, infra.processed_event restart identity`;
  await api.db.sql`truncate identity.player_identity, identity.player cascade`;
  tokens = {};
  players = {};
  for (const tenant of ['tenant-a', 'tenant-b'] as const) {
    await request(api.app.getHttpServer())
      .put('/v1/admin/store-items/spins-50')
      .set('authorization', `Bearer ${operatorKeys[tenant]}`)
      .send({ price: 100, reward: { kind: 'free_spins', count: 50 }, name: '50 spins' });
    await session(tenant, 'player-77');
    await topUp(tenant, 500);
  }
  await request(mock).post('/casino-a/_mock/flaky').send({ failures: 0 });
  await request(mock).post('/casino-b/_mock/flaky').send({ failures: 0 });
});

describe('rewards — issuance', () => {
  it('S1 — a successful issuance reaches issued with the operator reference', async () => {
    const id = await redeem('tenant-a', 'k1');
    await drain();

    const status = await statusOf('tenant-a', id);
    expect(status.status).toBe('issued');
    expect(status.externalRef).toMatch(/^A-/);
    expect(status.lastError).toBeNull();
  });

  it('S2 — operator B gets its own command envelope and its own reference shape', async () => {
    const id = await redeem('tenant-b', 'k2');
    await drain();

    const status = await statusOf('tenant-b', id);
    expect(status.status).toBe('issued');
    expect(status.externalRef).toMatch(/^B-/);
  });

  it('S3 — a timeout is retryable and the redemption stays claimable', async () => {
    await api.db.sql`update rewards.store_item set reward = ${api.db.sql.json({ kind: 'free_spins', count: 50 })}`;
    const id = await redeem('tenant-a', 'k3');
    await request(mock).post('/casino-a/_mock/flaky').send({ failures: 0 });
    // The mock never answers while this header is set, so the adapter's own
    // timeout has to fire.
    await api.db.sql`update rewards.redemption set last_error = null where id = ${id}`;
    await api.db.sql`insert into rewards.store_item (tenant_id, item_id, name, price, reward)
      values ('tenant-a', 'timeout-marker', 'x', 1, ${api.db.sql.json({ kind: 'free_spins', count: 1 })})
      on conflict do nothing`;

    await withMockBehaviour('timeout', async () => {
      await drain();
    });

    const status = await statusOf('tenant-a', id);
    expect(status.status).toBe('pending_issuance');
    expect(status.attempts).toBe(1);
    expect(status.lastError).toMatch(/timeout|abort/i);

    const rows = await api.db.sql`select next_attempt_at from rewards.redemption where id = ${id}`;
    expect(new Date(rows[0]!.next_attempt_at as string).getTime()).toBeGreaterThan(api.clock.now().getTime());
  });

  it('S4 — a 5xx is retryable', async () => {
    const id = await redeem('tenant-a', 'k4');
    await request(mock).post('/casino-a/_mock/flaky').send({ failures: 1 });
    await drain();

    const status = await statusOf('tenant-a', id);
    expect(status.status).toBe('pending_issuance');
    expect(status.attempts).toBe(1);
  });

  it('S4 — a 4xx is terminal, and does not consume the attempt budget', async () => {
    const id = await redeem('tenant-a', 'k5');
    // An empty reward payload makes operator A answer 400.
    await api.db.sql`update rewards.redemption set reward = ${api.db.sql.json({ kind: 'free_spins', count: 0 })} where id = ${id}`;
    await drain();

    const status = await statusOf('tenant-a', id);
    expect(status.status).toBe('failed');
    expect(status.attempts).toBe(1);
  });

  it('S5 — an operator that fails twice then recovers ends issued', async () => {
    const id = await redeem('tenant-a', 'k6');
    await request(mock).post('/casino-a/_mock/flaky').send({ failures: 2 });

    await drain();
    expect((await statusOf('tenant-a', id)).status).toBe('pending_issuance');
    await drain();
    expect((await statusOf('tenant-a', id)).status).toBe('pending_issuance');
    await drain();

    const status = await statusOf('tenant-a', id);
    expect(status.status).toBe('issued');
    expect(status.attempts).toBe(2);
  });

  it('S6 — attempts are bounded, and exhaustion refunds the coins', async () => {
    const before = await balance('tenant-a');
    const id = await redeem('tenant-a', 'k7');
    expect(await balance('tenant-a')).toBe(before - 100);

    await request(mock).post('/casino-a/_mock/flaky').send({ failures: 99 });
    for (let i = 0; i < 4; i += 1) await drain();

    const status = await statusOf('tenant-a', id);
    expect(status.status).toBe('failed');
    expect(await balance('tenant-a')).toBe(before);

    const refunds = await api.db.sql`
      select idempotency_key, coins, direction from ledger.entry where idempotency_key = ${`redemption:${id}:refund`}`;
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ direction: 'credit', coins: 100 });
  });

  it('S7 — the refund is idempotent', async () => {
    const before = await balance('tenant-a');
    const id = await redeem('tenant-a', 'k8');
    await request(mock).post('/casino-a/_mock/flaky').send({ failures: 99 });
    for (let i = 0; i < 6; i += 1) await drain();

    expect(await balance('tenant-a')).toBe(before);
    const refunds = await api.db.sql`
      select count(*)::int as n from ledger.entry where idempotency_key = ${`redemption:${id}:refund`}`;
    expect(refunds[0]!.n).toBe(1);
  });

  it('S8 — a terminal failure refunds too', async () => {
    const before = await balance('tenant-a');
    const id = await redeem('tenant-a', 'k9');
    await api.db.sql`update rewards.redemption set reward = ${api.db.sql.json({ kind: 'free_spins', count: 0 })} where id = ${id}`;
    await drain();

    expect((await statusOf('tenant-a', id)).status).toBe('failed');
    expect(await balance('tenant-a')).toBe(before);
  });

  it('S10 — two workers draining the same redemption make one operator call', async () => {
    const id = await redeem('tenant-a', 'k10');
    const consumer = api.app.get(IssueRedemptionConsumer);
    const rows = await api.db.sql`select * from infra.outbox where name = 'rewards.redemption.requested'`;
    const event = {
      id: String(rows[0]!.id),
      name: rows[0]!.name as string,
      tenantId: rows[0]!.tenant_id as string,
      aggregateType: 'redemption',
      aggregateId: rows[0]!.aggregate_id as string,
      payload: rows[0]!.payload as Record<string, unknown>,
      occurredAt: rows[0]!.occurred_at as Date,
    };

    await Promise.allSettled([consumer.consume(event), consumer.consume(event)]);

    const status = await statusOf('tenant-a', id);
    expect(status.status).toBe('issued');
    expect(status.attempts).toBeLessThanOrEqual(1);
  });
});

/** Set the mock's behaviour for the duration of a block, through its flaky switch. */
async function withMockBehaviour(behaviour: string, fn: () => Promise<void>): Promise<void> {
  await request(mock).post('/casino-a/_mock/behaviour').send({ behaviour });
  try {
    await fn();
  } finally {
    await request(mock).post('/casino-a/_mock/behaviour').send({ behaviour: 'none' });
  }
}
