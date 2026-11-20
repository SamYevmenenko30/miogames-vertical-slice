import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCasinoMock } from '../../../mocks/casino-platform/app';
import { withTenant } from '../../../platform/db/tenant-context';
import { LOGGER, type LogFields, type Logger } from '../../../platform/observability/logger';
import { startTestApi, type TestApi } from '../../../test/api.helper';
import { IdentityFacade } from '../../identity';
import { IntegrationFacade } from '../../integration';
import { LedgerFacade } from '../../ledger';
import { IssueRewardUseCase } from '../application/issue-reward.usecase';

/**
 * MIO-015 — the issuance CLAIM: who may write the outcome back, and what is
 * recorded before the operator is asked.
 *
 * Its own file rather than cases added to `issuance.integration.spec.ts`, for
 * two reasons. The pipeline's reason: `red-check` measures added FILES, so cases
 * appended to an existing spec are never proved red at the merge-base — which is
 * how every test of the previous fix round entered the repository (review
 * R2-B3). The reading reason: MIO-010's file is about issuance succeeding and
 * failing, this one is about two workers disagreeing about who owns a redemption.
 */
let api: TestApi;
let mock: Server;
let tokens: Record<string, string> = {};
let players: Record<string, string> = {};
let warnings: Array<{ fields: LogFields; message: string }> = [];

const operatorKeys = { 'tenant-a': 'key-a.secret-a', 'tenant-b': 'key-b.secret-b' } as const;
type Tenant = keyof typeof operatorKeys;

const session = async (tenant: Tenant, external: string) => {
  const res = await request(api.app.getHttpServer())
    .post('/v1/sessions')
    .set('authorization', `Bearer ${operatorKeys[tenant]}`)
    .send({ externalPlayerId: external });
  const rows = await api.db.sql`
    select player_id from identity.player_identity where tenant_id = ${tenant} and external_player_id = ${external}`;
  tokens[tenant] = res.body.token;
  players[tenant] = rows[0]!.player_id as string;
};

const topUp = async (tenant: Tenant, coins: number) => {
  const ledger = api.app.get(LedgerFacade);
  await withTenant(tenant, async () =>
    ledger.credit({ playerId: players[tenant]!, coins, reason: 'test.topup', idempotencyKey: `topup-${tenant}` }),
  );
};

const redeem = async (tenant: Tenant, key: string) => {
  const res = await request(api.app.getHttpServer())
    .post('/v1/redemptions')
    .set('authorization', `Bearer ${tokens[tenant]}`)
    .set('idempotency-key', key)
    .send({ itemId: 'spins-50' });
  expect(res.status).toBe(202);
  return res.body.redemptionId as string;
};

type RedemptionStatusBody = {
  status: string;
  attempts: number;
  lastError: string | null;
  externalRef: string | null;
  grantRequests: number;
  grantRequestedAt: string | null;
};

const statusOf = async (tenant: Tenant, id: string): Promise<RedemptionStatusBody> => {
  const res = await request(api.app.getHttpServer())
    .get(`/v1/redemptions/${id}`)
    .set('authorization', `Bearer ${tokens[tenant]}`);
  return res.body as RedemptionStatusBody;
};

/** How many reward grants the operator was actually asked for, 500s included. */
const rewardCalls = async (operator: 'casino-a' | 'casino-b') => {
  const res = await request(mock).get(`/${operator}/_mock/reward-calls`);
  return res.body.calls as number;
};

const balance = async (tenant: Tenant) => {
  const rows = await api.db.sql`
    select coins from ledger.balance where tenant_id = ${tenant} and player_id = ${players[tenant]!}`;
  return Number(rows[0]?.coins ?? 0);
};

const claimedBy = async (id: string) => {
  const rows = await api.db.sql`select claimed_by from rewards.redemption where id = ${id}`;
  return rows[0]?.claimed_by as string | null;
};

/** The lease is measured on the DATABASE clock, so the injected clock cannot age it. */
const expireTheLease = async (id: string) => {
  await api.db.sql`update rewards.redemption set claimed_at = now() - interval '1 hour' where id = ${id}`;
};

/** Swap the operator call for the duration of a block, as MIO-010's suite does. */
const withOperator = async (stub: (...args: unknown[]) => Promise<unknown>, fn: () => Promise<void>) => {
  const integration = api.app.get(IntegrationFacade);
  const real = integration.issueReward.bind(integration);
  (integration as unknown as { issueReward: unknown }).issueReward = stub;
  try {
    await fn();
  } finally {
    (integration as unknown as { issueReward: unknown }).issueReward = real;
  }
};

const realOperator = () => {
  const integration = api.app.get(IntegrationFacade);
  return integration.issueReward.bind(integration);
};

/**
 * The race every statement here is about: worker A claims, stalls inside the
 * operator call until its lease has expired, worker B re-claims and issues, and
 * only then does A come back with `outcome`.
 *
 * Returns once A has finished writing — or not writing — its outcome.
 */
async function staleHolderRace(id: string, outcome: { outcome: 'terminal' | 'retryable'; reason: string }) {
  const issue = api.app.get(IssueRewardUseCase);
  const integration = api.app.get(IntegrationFacade);
  const real = realOperator();

  let entered: () => void = () => {};
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  let release: () => void = () => {};
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });

  (integration as unknown as { issueReward: unknown }).issueReward = async () => {
    entered();
    await releasePromise;
    return outcome;
  };
  const workerA = withTenant('tenant-a', async () => issue.execute(id));
  await enteredPromise;

  await expireTheLease(id);

  // Worker B takes over and succeeds, through the real operator.
  (integration as unknown as { issueReward: unknown }).issueReward = real;
  await withTenant('tenant-a', async () => issue.execute(id));

  release();
  await workerA;
}

beforeAll(async () => {
  mock = createCasinoMock().listen(0);
  const address = mock.address();
  const mockUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  api = await startTestApi('issuance-claim', {
    CASINO_MOCK_BASE_URL: mockUrl,
    ISSUANCE_TIMEOUT_MS: '300',
    ISSUANCE_MAX_ATTEMPTS: '3',
    ISSUANCE_BASE_BACKOFF_MS: '1',
  });

  // The use case holds the very object the container provides, so wrapping `warn`
  // here observes what it actually logs. `LOG_LEVEL` is silent in tests, which is
  // why the assertion cannot be made on the output stream.
  const logger = api.app.get<Logger>(LOGGER);
  const realWarn = logger.warn.bind(logger);
  logger.warn = (fields: LogFields, message?: string) => {
    warnings.push({ fields, message: message ?? '' });
    realWarn(fields, message);
  };

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
  warnings = [];
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

describe('MIO-015 — the issuance claim', () => {
  it('S1 — a write-back requires the claim it was taken under: a stale holder changes nothing', async () => {
    const id = await redeem('tenant-a', 'c1');

    await staleHolderRace(id, { outcome: 'terminal', reason: 'operator A rejected the request with 400' });

    const final = await statusOf('tenant-a', id);
    // Worker B's outcome, untouched by the worker that no longer held the claim.
    expect(final.status).toBe('issued');
    expect(final.externalRef).toMatch(/^A-/);
    expect(final.lastError).toBeNull();
    // And the claim is released by the write-back that DID match, not left behind
    // by one that did not.
    expect(await claimedBy(id)).toBeNull();
  });

  it('S2 — a stale holder’s failure does not refund a reward that was issued', async () => {
    const before = await balance('tenant-a');
    const id = await redeem('tenant-a', 'c2');
    expect(await balance('tenant-a')).toBe(before - 100);

    await staleHolderRace(id, { outcome: 'terminal', reason: 'operator A rejected the request with 400' });

    // The reward was granted once and paid for once. The defect this pins paid the
    // player AND gave them the reward: `markFailed` keyed only on (tenant, id), so
    // the refund in the same transaction ran on a redemption that was `issued`.
    expect(await balance('tenant-a')).toBe(before - 100);
    const refunds = await api.db.sql`
      select count(*)::int as n from ledger.entry where idempotency_key = ${`redemption:${id}:refund`}`;
    expect(refunds[0]!.n).toBe(0);
    // Tightening the UPDATE alone would still have published this.
    const failed = await api.db.sql`
      select count(*)::int as n from infra.outbox
       where name = 'rewards.redemption.failed' and aggregate_id = ${id}`;
    expect(failed[0]!.n).toBe(0);
    expect(await rewardCalls('casino-a')).toBe(1);
  });

  it('S3 — a stale holder’s retryable failure does not resurrect an issued redemption', async () => {
    const id = await redeem('tenant-a', 'c3');

    await staleHolderRace(id, { outcome: 'retryable', reason: 'operator A answered 503' });

    // The mirror case, and it needs no refund to be expensive: back in
    // `pending_issuance` the sweep would ask the operator to grant it again.
    const final = await statusOf('tenant-a', id);
    expect(final.status).toBe('issued');
    const scheduled = await api.db.sql`
      select next_attempt_at from rewards.redemption where id = ${id}`;
    expect(scheduled[0]!.next_attempt_at).toBeNull();
    expect(await rewardCalls('casino-a')).toBe(1);
  });

  it('S4 — a worker that finds its claim gone says so, naming the claim it was holding', async () => {
    const id = await redeem('tenant-a', 'c4');

    await staleHolderRace(id, { outcome: 'terminal', reason: 'operator A rejected the request with 400' });

    const lost = warnings.filter((w) => w.fields.redemptionId === id && typeof w.fields.claim === 'string');
    expect(lost).toHaveLength(1);
    expect(lost[0]!.message).toMatch(/claim/i);
  });

  it('S5 — two claims of one redemption are two different claims, each naming the instance', async () => {
    const id = await redeem('tenant-a', 'c5');
    const issue = api.app.get(IssueRewardUseCase);
    const claims: Array<string | null> = [];

    // Both claims are taken by THIS process, which is the case a per-process
    // `claimed_by` cannot distinguish — and it is the dangerous one, because the
    // first attempt is still inside the operator call when the second claims.
    for (let i = 0; i < 2; i += 1) {
      await withOperator(async () => {
        claims.push(await claimedBy(id));
        throw new Error('the worker died inside the operator call');
      }, async () => {
        await expect(withTenant('tenant-a', async () => issue.execute(id))).rejects.toThrow();
      });
      await expireTheLease(id);
    }

    expect(claims[0]).not.toBe(claims[1]);
    expect(claims[0]).toContain(api.config.instanceId);
    expect(claims[1]).toContain(api.config.instanceId);
  });

  it('S7 — the grant request is recorded BEFORE the operator is called', async () => {
    const id = await redeem('tenant-a', 'c7');
    const issue = api.app.get(IssueRewardUseCase);
    const real = realOperator();
    const observed: Array<number | undefined> = [];

    // Read through the status API from INSIDE the operator call: whatever it
    // reports here is committed, so it survives the process being killed next.
    await withOperator(async (...args: unknown[]) => {
      observed.push((await statusOf('tenant-a', id)).grantRequests);
      return real(...(args as Parameters<typeof real>));
    }, async () => {
      await withTenant('tenant-a', async () => issue.execute(id));
    });

    expect(observed).toEqual([1]);
  });

  it('S8 — a redemption issued on its first call records exactly one grant request', async () => {
    const id = await redeem('tenant-a', 'c8');
    const issue = api.app.get(IssueRewardUseCase);
    await withTenant('tenant-a', async () => issue.execute(id));

    const final = await statusOf('tenant-a', id);
    expect(final.status).toBe('issued');
    expect(final.grantRequests).toBe(1);
    expect(await rewardCalls('casino-a')).toBe(1);
  });

  it('S9 — a redemption recovered after a worker died AFTER the grant records two', async () => {
    const before = await balance('tenant-a');
    const id = await redeem('tenant-a', 'c9');
    const issue = api.app.get(IssueRewardUseCase);
    const real = realOperator();

    // The operator grants, and the process is lost before the outcome is written.
    await withOperator(async (...args: unknown[]) => {
      await real(...(args as Parameters<typeof real>));
      throw new Error('the process died after the operator granted the reward');
    }, async () => {
      await expect(withTenant('tenant-a', async () => issue.execute(id))).rejects.toThrow();
    });
    expect((await statusOf('tenant-a', id)).status).toBe('issuing');
    expect(await rewardCalls('casino-a')).toBe(1);

    await expireTheLease(id);
    await withTenant('tenant-a', async () => issue.execute(id));

    const recovered = await statusOf('tenant-a', id);
    expect(recovered.status).toBe('issued');
    // The operator was asked TWICE for one redemption. That is what the lease
    // buys, it cannot be prevented from this side (neither simulated operator
    // honours `Idempotency-Key`, and no real one can be made to — TD-0011), and
    // the point of this statement is that it is now written down instead of
    // looking like a clean first-attempt success.
    expect(recovered.grantRequests).toBe(2);
    expect(await rewardCalls('casino-a')).toBe(2);
    // Paid for once either way.
    expect(await balance('tenant-a')).toBe(before - 100);
  });

  it('S10 — the status API reports the grant record', async () => {
    const id = await redeem('tenant-a', 'c10');
    expect(await statusOf('tenant-a', id)).toMatchObject({ grantRequests: 0, grantRequestedAt: null });

    const issue = api.app.get(IssueRewardUseCase);
    await withTenant('tenant-a', async () => issue.execute(id));

    const final = await statusOf('tenant-a', id);
    expect(final.grantRequests).toBe(1);
    expect(Number.isNaN(Date.parse(String(final.grantRequestedAt)))).toBe(false);
  });

  it('S11 — an issuance completed after more than one grant request is logged for reconciliation', async () => {
    const id = await redeem('tenant-a', 'c11');
    const issue = api.app.get(IssueRewardUseCase);
    const real = realOperator();

    await withOperator(async (...args: unknown[]) => {
      await real(...(args as Parameters<typeof real>));
      throw new Error('the process died after the operator granted the reward');
    }, async () => {
      await expect(withTenant('tenant-a', async () => issue.execute(id))).rejects.toThrow();
    });
    await expireTheLease(id);
    warnings = [];
    await withTenant('tenant-a', async () => issue.execute(id));

    const reconcile = warnings.filter((w) => w.fields.redemptionId === id && w.fields.grantRequests === 2);
    expect(reconcile).toHaveLength(1);
    expect(reconcile[0]!.message).toMatch(/reconcil/i);
    expect(reconcile[0]!.fields.externalRef).toMatch(/^A-/);
  });
});
