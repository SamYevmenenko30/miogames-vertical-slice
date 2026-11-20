import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../../platform/db/tenant-context';
import { createCasinoMock } from '../../../mocks/casino-platform/app';
import { startTestApi, type TestApi } from '../../../test/api.helper';
import { IdentityFacade } from '../../identity';
import { IntegrationFacade } from '../../integration';
import { LedgerFacade } from '../../ledger';
import { IssueRedemptionConsumer } from '../adapters/in/issue-redemption.consumer';
import { IssuanceWorker } from '../application/issuance.worker';
import { IssueRewardUseCase } from '../application/issue-reward.usecase';

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

/** How many reward grants the operator was actually asked for, 500s included. */
const rewardCalls = async (operator: 'casino-a' | 'casino-b') => {
  const res = await request(mock).get(`/${operator}/_mock/reward-calls`);
  return res.body.calls as number;
};

const balance = async (tenant: keyof typeof operatorKeys) => {
  const rows = await api.db.sql`
    select coins from ledger.balance where tenant_id = ${tenant} and player_id = ${players[tenant]!}`;
  return Number(rows[0]?.coins ?? 0);
};

/**
 * One worker cycle: move time on, run whatever retries are now due, then relay
 * any new outbox events.
 *
 * The clock has to advance, because the retry schedule is measured on the
 * injected clock — a fixed clock cannot exercise a schedule. The first version of
 * this helper relied on the database clock being ahead of the test's, which made
 * a single drain perform two attempts, non-deterministically. One second is far
 * more than the backoff at these settings and far less than the token's hour.
 */
const drain = async () => {
  api.clock.advance(1000);
  await api.app.get(IssuanceWorker).runDueRetries();

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
  await request(mock).post('/casino-a/_mock/reset').send({});
  await request(mock).post('/casino-b/_mock/reset').send({});
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
    const id = await redeem('tenant-a', 'k3');
    // The operator never answers while this is set, so the adapter's own timeout
    // is what has to fire — and the test asserts that it did, by the reason.
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
    // The BOUNDARY of the budget, not just its interior: ISSUANCE_MAX_ATTEMPTS is 3
    // here, so the operator is asked exactly three times and `attempts` lands on
    // three. Without this, `attempts >= max` could become `attempts > max` — one
    // extra call to a failing operator for every redemption — and stay green.
    expect(status.attempts).toBe(3);
    expect(await rewardCalls('casino-a')).toBe(3);

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

  it('S10 — two workers racing the same redemption make exactly ONE operator call', async () => {
    const id = await redeem('tenant-a', 'k10');
    expect(await rewardCalls('casino-a')).toBe(0);

    // TWO WORKERS, not one consumer called twice. Both enter the tenant and both
    // reach the use case, so what settles the race is the
    // `pending_issuance → issuing` conditional UPDATE — the mechanism this
    // statement is about. Driving the consumer twice with ONE event id instead
    // puts `infra.processed_event` in charge, which is a different guarantee and
    // is already proved in platform/events; this test used to do that, and so it
    // stayed green when the claim predicate was deleted. It also now COUNTS the
    // operator calls, because "one operator call" is a claim about how many times
    // the operator was asked and cannot be checked by reading the final status.
    const issue = api.app.get(IssueRewardUseCase);
    const results = await Promise.allSettled([
      withTenant('tenant-a', async () => issue.execute(id)),
      withTenant('tenant-a', async () => issue.execute(id)),
    ]);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);

    expect(await rewardCalls('casino-a')).toBe(1);
    const status = await statusOf('tenant-a', id);
    expect(status.status).toBe('issued');
    // `attempts` counts attempts that FAILED (only scheduleRetry/markFailed move
    // it), so a redemption issued on its first call reports 0. Asserted exactly,
    // because the inequality this test used to carry (`<= 1`) was satisfied by
    // every outcome it was meant to distinguish.
    expect(status.attempts).toBe(0);
  });

  it('S11 — a worker that dies mid-issuance does not wedge the redemption: the lease expires and the sweep recovers it', async () => {
    const before = await balance('tenant-a');
    const id = await redeem('tenant-a', 'k11');
    expect(await balance('tenant-a')).toBe(before - 100);

    // One retryable failure, so the RETRY SWEEP owns the next attempt. There the
    // claim commits in its own transaction, which is the state a crash leaves
    // behind; on the first attempt the consumer's transaction would roll it back.
    await request(mock).post('/casino-a/_mock/flaky').send({ failures: 1 });
    await drain();
    expect((await statusOf('tenant-a', id)).status).toBe('pending_issuance');

    // The worker dies after claiming, at the operator call.
    const integration = api.app.get(IntegrationFacade);
    const real = integration.issueReward.bind(integration);
    (integration as unknown as { issueReward: unknown }).issueReward = async () => {
      throw new Error('the worker process died after the operator call');
    };
    await drain();
    (integration as unknown as { issueReward: unknown }).issueReward = real;
    expect((await statusOf('tenant-a', id)).status).toBe('issuing');

    // While the lease is FRESH the redemption is left alone: a live worker must
    // not have its in-flight issuance taken away mid-call.
    await drain();
    expect((await statusOf('tenant-a', id)).status).toBe('issuing');

    // Age the lease instead of waiting ISSUANCE_CLAIM_TIMEOUT_MS out. The lease is
    // measured on the DATABASE clock — deciding another process is dead needs the
    // clock every process shares — so the injected clock cannot move it, and a
    // real wait would only make this test slow.
    await api.db.sql`update rewards.redemption set claimed_at = now() - interval '1 hour' where id = ${id}`;

    await drain();
    const recovered = await statusOf('tenant-a', id);
    expect(recovered.status).toBe('issued');
    expect(recovered.externalRef).toMatch(/^A-/);
    // Paid for once, and received: no refund, no second debit.
    expect(await balance('tenant-a')).toBe(before - 100);
  });

  it('S12 — an `issuing` row left behind with no lease at all is recovered too', async () => {
    const id = await redeem('tenant-a', 'k12');
    // Exactly the shape migration 0012 inherits: rows already wedged in `issuing`
    // when the lease column arrived have claimed_at NULL. NULL counts as stale, so
    // they heal on the next tick rather than needing a hand-written UPDATE.
    await api.db.sql`
      update rewards.redemption set status = 'issuing', claimed_at = null, claimed_by = null where id = ${id}`;

    await drain();

    expect((await statusOf('tenant-a', id)).status).toBe('issued');
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
