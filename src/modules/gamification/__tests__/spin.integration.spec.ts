import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex, uniform01 } from '../../../platform/crypto/crypto';
import { startTestApi, type TestApi } from '../../../test/api.helper';
import { IdentityFacade } from '../../identity';
import { weightedPick, type WheelSlice } from '../domain/wheel';

let api: TestApi;
let token: string;

const slices: WheelSlice[] = [
  { id: 'small', weight: 50, prize: { kind: 'coins', amount: 10 } },
  { id: 'big', weight: 30, prize: { kind: 'coins', amount: 100 } },
  { id: 'spins', weight: 15, prize: { kind: 'free_spins', count: 5 } },
  { id: 'nothing', weight: 5, prize: { kind: 'nothing' } },
];

const session = (externalPlayerId: string, key = 'key-a.secret-a') =>
  request(api.app.getHttpServer())
    .post('/v1/sessions')
    .set('authorization', `Bearer ${key}`)
    .send({ externalPlayerId });

const spin = (bearer: string, body: object = {}) =>
  request(api.app.getHttpServer()).post('/v1/spins').set('authorization', `Bearer ${bearer}`).send(body);

const grantEntitlement = async (tenant: string, playerId: string, opts: { expiresInHours?: number } = {}) => {
  const seed = 'a'.repeat(64);
  const grantedAt = api.clock.now();
  const expires = new Date(grantedAt.getTime() + (opts.expiresInHours ?? 168) * 3600 * 1000);
  const id = crypto.randomUUID();
  await api.db.sql`
    insert into gamification.spin_entitlement
      (id, tenant_id, player_id, wheel_id, wheel_version, rule_id, state, server_seed, seed_hash,
       source_event_id, granted_at, expires_at)
    values (${id}, ${tenant}, ${playerId}, 'welcome', 1, 'bronze', 'granted', ${seed}, ${sha256Hex(seed)},
            'evt', ${grantedAt.toISOString()}, ${expires.toISOString()})`;
  return { id, seed };
};

const playerIdOf = async (external: string, tenant = 'tenant-a') => {
  const rows = await api.db.sql`
    select player_id from identity.player_identity where tenant_id = ${tenant} and external_player_id = ${external}`;
  return rows[0]!.player_id as string;
};

beforeAll(async () => {
  api = await startTestApi('spin');
  const identity = api.app.get(IdentityFacade);
  await identity.provisionTenant({ id: 'tenant-a', name: 'A', operator: 'casino-a', keyId: 'key-a', secret: 'secret-a' });
  await identity.provisionTenant({ id: 'tenant-b', name: 'B', operator: 'casino-b', keyId: 'key-b', secret: 'secret-b' });

  for (const tenant of ['tenant-a', 'tenant-b']) {
    await api.db.sql`insert into gamification.wheel (tenant_id, id, name) values (${tenant}, 'welcome', 'Welcome')`;
    await api.db.sql`
      insert into gamification.wheel_version (tenant_id, wheel_id, version, slices, created_by)
      values (${tenant}, 'welcome', 1, ${api.db.sql.json(slices)}, 'seed')`;
    await api.db.sql`
      insert into gamification.reward_rule (tenant_id, id, min_deposit_minor, currency, wheel_id, spins, ttl_hours)
      values (${tenant}, 'bronze', 2000, 'EUR', 'welcome', 1, 168)`;
  }
});

afterAll(async () => {
  await api?.close();
});

beforeEach(async () => {
  await api.db.sql`truncate gamification.spin, gamification.spin_entitlement, ledger.entry, ledger.balance`;
  await api.db.sql`truncate identity.player_identity, identity.player cascade`;
  const created = await session('player-77');
  token = created.body.token;
});

describe('gamification — sessions', () => {
  it('S10 — the operator exchanges its credentials for a short-lived player token', async () => {
    const res = await session('player-77');
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[\w-]+\.[0-9a-f]+$/);
    expect(res.body.expiresInSeconds).toBeGreaterThan(0);
  });

  it('S10 — minting a session provisions the player if it is new', async () => {
    await session('brand-new');
    const rows = await api.db.sql`
      select count(*)::int as n from identity.player_identity where external_player_id = 'brand-new'`;
    expect(rows[0]!.n).toBe(1);
  });

  it('S10 — a session request without operator credentials is 401', async () => {
    const res = await request(api.app.getHttpServer()).post('/v1/sessions').send({ externalPlayerId: 'x' });
    expect(res.status).toBe(401);
  });

  it('S1 — a spin without a token is 401', async () => {
    const res = await request(api.app.getHttpServer()).post('/v1/spins').send({});
    expect(res.status).toBe(401);
  });
});

describe('gamification — the spin', () => {
  it('S1 — it claims one entitlement, draws, credits coins and reports the balance', async () => {
    const player = await playerIdOf('player-77');
    await grantEntitlement('tenant-a', player);

    const res = await spin(token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ wheelId: 'welcome', wheelVersion: 1 });
    expect(slices.map((s) => s.id)).toContain(res.body.sliceId);
    expect(res.body.remainingSpins).toBe(0);

    const rows = await api.db.sql`select state from gamification.spin_entitlement`;
    expect(rows[0]!.state).toBe('consumed');
  });

  it('S2 — the outcome is exactly what the revealed seed and spin id compute', async () => {
    const player = await playerIdOf('player-77');
    await grantEntitlement('tenant-a', player);

    const res = await spin(token);
    const expected = weightedPick(slices, uniform01(res.body.fairness.seed, res.body.spinId));
    expect(res.body.sliceId).toBe(expected.id);
    expect(res.body.prize).toEqual(expected.prize);
  });

  it('S8 — the response reveals enough to recompute the draw, and the hash matches the commitment', async () => {
    const player = await playerIdOf('player-77');
    const granted = await grantEntitlement('tenant-a', player);

    const res = await spin(token);
    expect(res.body.fairness.seed).toBe(granted.seed);
    expect(res.body.fairness.seedHash).toBe(sha256Hex(granted.seed));
    expect(res.body.fairness.wheelVersion).toBe(1);
    expect(res.body.spinId).toMatch(/[0-9a-f-]{36}/);
  });

  it('S3 — nothing the client sends changes the outcome', async () => {
    const player = await playerIdOf('player-77');
    await grantEntitlement('tenant-a', player);
    const plain = await spin(token);

    await api.db.sql`truncate gamification.spin, gamification.spin_entitlement, ledger.entry, ledger.balance`;
    await grantEntitlement('tenant-a', player);
    const loaded = await spin(token, { clientSeed: 'please-give-me-the-jackpot', stake: 99999, preferredSlice: 'big' });

    // Same seed, different spin id — so the test asserts the RULE, not the value:
    // the outcome is the function of (seed, spinId) and of nothing else.
    expect(loaded.status).toBe(200);
    const expected = weightedPick(slices, uniform01(loaded.body.fairness.seed, loaded.body.spinId));
    expect(loaded.body.sliceId).toBe(expected.id);
    expect(plain.body.fairness.seed).toBe(loaded.body.fairness.seed);
  });

  it('S4 — two concurrent spins on one entitlement: exactly one wins', async () => {
    const player = await playerIdOf('player-77');
    await grantEntitlement('tenant-a', player);

    const [a, b] = await Promise.all([spin(token), spin(token)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const spins = await api.db.sql`select count(*)::int as n from gamification.spin`;
    expect(spins[0]!.n).toBe(1);
    const entries = await api.db.sql`select count(*)::int as n from ledger.entry`;
    expect(entries[0]!.n).toBeLessThanOrEqual(1);
  });

  it('S5 — no claimable entitlement is a 409 with a machine-readable type', async () => {
    const res = await spin(token);
    expect(res.status).toBe(409);
    expect(res.body.type).toContain('spin.no-entitlement');
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  it('S6 — an expired entitlement is not claimable', async () => {
    const player = await playerIdOf('player-77');
    await grantEntitlement('tenant-a', player, { expiresInHours: 1 });
    api.clock.advance(2 * 3600 * 1000);

    const res = await spin(token);
    expect(res.status).toBe(409);
    const rows = await api.db.sql`select state from gamification.spin_entitlement`;
    expect(rows[0]!.state).toBe('granted');
  });

  it('S7 — the credit carries the spin idempotency key', async () => {
    const player = await playerIdOf('player-77');
    await grantEntitlement('tenant-a', player);
    const res = await spin(token);

    if (res.body.prize.kind === 'coins') {
      const entries = await api.db.sql`select idempotency_key, coins from ledger.entry`;
      expect(entries[0]!.idempotency_key).toBe(`spin:${res.body.spinId}`);
      expect(entries[0]!.coins).toBe(res.body.prize.amount);
    } else {
      const entries = await api.db.sql`select count(*)::int as n from ledger.entry`;
      expect(entries[0]!.n).toBe(0);
    }
  });

  it('S9 — the spin is recorded with everything needed for an audit', async () => {
    const player = await playerIdOf('player-77');
    await grantEntitlement('tenant-a', player);
    const res = await spin(token);

    const rows = await api.db.sql`select * from gamification.spin`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: 'tenant-a',
      wheel_id: 'welcome',
      wheel_version: 1,
      slice_id: res.body.sliceId,
    });
    expect(rows[0]!.server_seed).toBe(res.body.fairness.seed);
  });

  it('Q2 — a losing slice is still a successful spin', async () => {
    const player = await playerIdOf('player-77');
    // A wheel whose only slices lose, so the outcome is known without guessing.
    await api.db.sql`
      insert into gamification.wheel_version (tenant_id, wheel_id, version, slices, created_by)
      values ('tenant-a', 'welcome', 2, ${api.db.sql.json([
        { id: 'nothing-a', weight: 1, prize: { kind: 'nothing' } },
        { id: 'nothing-b', weight: 1, prize: { kind: 'nothing' } },
      ])}, 'test')`;
    const seed = 'b'.repeat(64);
    await api.db.sql`
      insert into gamification.spin_entitlement
        (id, tenant_id, player_id, wheel_id, wheel_version, rule_id, state, server_seed, seed_hash,
         source_event_id, granted_at, expires_at)
      values (${crypto.randomUUID()}, 'tenant-a', ${player}, 'welcome', 2, 'bronze', 'granted', ${seed},
              ${sha256Hex(seed)}, 'evt', ${api.clock.now().toISOString()},
              ${new Date(api.clock.now().getTime() + 3600_000).toISOString()})`;

    const res = await spin(token);
    expect(res.status).toBe(200);
    expect(res.body.prize).toEqual({ kind: 'nothing' });
    expect(await api.db.sql`select count(*)::int as n from ledger.entry`).toMatchObject([{ n: 0 }]);
  });
});
