import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CASINO_DEPOSIT_OBSERVED } from '../../../contracts/events';
import { sha256Hex } from '../../../platform/crypto/crypto';
import type { DeliveredEvent } from '../../../platform/events/idempotent-consumer';
import { startTestApi, type TestApi } from '../../../test/api.helper';
import { IdentityFacade } from '../../identity';
import { DepositObservedConsumer } from '../adapters/in/deposit-observed.consumer';

let api: TestApi;
let consumer: DepositObservedConsumer;

const deposit = (eventId: string, amountMinor = 5000, currency = 'EUR', player = 'player-77'): DeliveredEvent => ({
  id: eventId,
  name: CASINO_DEPOSIT_OBSERVED,
  tenantId: 'tenant-a',
  aggregateType: 'deposit',
  aggregateId: eventId,
  payload: {
    operator: 'casino-a',
    operatorEventId: `op-${eventId}`,
    externalPlayerId: player,
    amount: { amountMinor, currency },
    occurredAt: '2026-11-20T11:00:00.000Z',
    eventId,
  },
  occurredAt: new Date('2026-11-20T11:00:00.000Z'),
});

const entitlements = async (tenant = 'tenant-a') =>
  api.db.sql`select * from gamification.spin_entitlement where tenant_id = ${tenant} order by granted_at, id`;

beforeAll(async () => {
  api = await startTestApi('grant-entitlements');
  consumer = api.app.get(DepositObservedConsumer);
  const identity = api.app.get(IdentityFacade);
  await identity.provisionTenant({ id: 'tenant-a', name: 'A', operator: 'casino-a', keyId: 'key-a', secret: 'secret-a' });
  await identity.provisionTenant({ id: 'tenant-b', name: 'B', operator: 'casino-b', keyId: 'key-b', secret: 'secret-b' });

  for (const tenant of ['tenant-a']) {
    await api.db.sql`
      insert into gamification.wheel (tenant_id, id, name) values (${tenant}, 'welcome', 'Welcome')`;
    await api.db.sql`
      insert into gamification.wheel_version (tenant_id, wheel_id, version, slices, created_by)
      values (${tenant}, 'welcome', 1, ${api.db.sql.json([
        { id: 'small', weight: 50, prize: { kind: 'coins', amount: 10 } },
        { id: 'big', weight: 50, prize: { kind: 'coins', amount: 100 } },
      ])}, 'seed')`;
  }
});

afterAll(async () => {
  await api?.close();
});

beforeEach(async () => {
  await api.db.sql`truncate gamification.spin_entitlement, gamification.reward_rule, infra.processed_event`;
  await api.db.sql`truncate identity.player_identity, identity.player cascade`;
  await api.db.sql`
    insert into gamification.reward_rule (tenant_id, id, min_deposit_minor, currency, wheel_id, spins, ttl_hours)
    values ('tenant-a', 'bronze', 2000, 'EUR', 'welcome', 2, 168)`;
});

describe('gamification — granting entitlements', () => {
  it('S1 — a qualifying deposit grants the rule spins, pinned to the live wheel version', async () => {
    await consumer.consume(deposit('evt-1'));
    const rows = await entitlements();

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.state).toBe('granted');
      expect(row.wheel_id).toBe('welcome');
      expect(row.wheel_version).toBe(1);
      expect(row.rule_id).toBe('bronze');
    }
  });

  it('S2 — each entitlement carries a distinct committed seed', async () => {
    await consumer.consume(deposit('evt-2'));
    const rows = await entitlements();
    const seeds = rows.map((r) => r.server_seed as string);

    expect(new Set(seeds).size).toBe(2);
    for (const row of rows) {
      expect(row.server_seed).toMatch(/^[0-9a-f]{64}$/);
      expect(row.seed_hash).toBe(sha256Hex(row.server_seed as string));
    }
  });

  it('S3 — a deposit below the threshold grants nothing but is still processed', async () => {
    await consumer.consume(deposit('evt-3', 1000));
    expect(await entitlements()).toHaveLength(0);
    const processed = await api.db.sql`select count(*)::int as n from infra.processed_event`;
    expect(processed[0]!.n).toBe(1);
  });

  it('S5 — the same event delivered twice grants the spins once', async () => {
    const event = deposit('evt-4');
    await consumer.consume(event);
    await consumer.consume(event);
    expect(await entitlements()).toHaveLength(2);
  });

  it('S6 — the player is provisioned here, and reused by a second deposit', async () => {
    const before = await api.db.sql`select count(*)::int as n from identity.player`;
    expect(before[0]!.n).toBe(0);

    await consumer.consume(deposit('evt-5'));
    const after = await api.db.sql`select id from identity.player`;
    expect(after).toHaveLength(1);

    await consumer.consume(deposit('evt-6'));
    const again = await api.db.sql`select count(*)::int as n from identity.player`;
    expect(again[0]!.n).toBe(1);
    expect((await entitlements()).every((row) => row.player_id === after[0]!.id)).toBe(true);
  });

  it('S7 — expiry is the grant time plus the rule TTL, on the injected clock', async () => {
    await consumer.consume(deposit('evt-7'));
    const rows = await entitlements();
    const granted = new Date(rows[0]!.granted_at as string).getTime();
    const expires = new Date(rows[0]!.expires_at as string).getTime();

    expect(granted).toBe(api.clock.now().getTime());
    expect(expires - granted).toBe(168 * 3600 * 1000);
  });

  it('S9 — a tenant with no rules grants nothing for the same deposit', async () => {
    const forB: DeliveredEvent = { ...deposit('evt-8'), tenantId: 'tenant-b' };
    await consumer.consume(forB);
    expect(await entitlements('tenant-b')).toHaveLength(0);
  });

  it('Q1 — a rule naming an unconfigured wheel fails loudly instead of granting odd-less spins', async () => {
    await api.db.sql`update gamification.reward_rule set wheel_id = 'ghost' where tenant_id = 'tenant-a'`;
    await expect(consumer.consume(deposit(randomUUID()))).rejects.toThrowError(/ghost|wheel/i);
    expect(await entitlements()).toHaveLength(0);
  });
});
