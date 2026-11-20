import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IdentityFacade } from '../../identity';
import { signed, startTestApi, type TestApi } from '../../../test/api.helper';

let api: TestApi;

const depositA = (eventId: string, amount = '50.00') => ({
  event: 'deposit.completed',
  event_id: eventId,
  user_id: 'player-77',
  amount,
  currency: 'EUR',
  occurred_at: '2026-11-20T11:00:00.000Z',
});

const post = (body: unknown, keyId = 'key-a', secret = 'secret-a', operator = 'casino-a', skew = 0) => {
  const now = Math.floor(api.clock.now().getTime() / 1000) + skew;
  const { raw, headers } = signed(body, keyId, secret, now);
  return request(api.app.getHttpServer()).post(`/v1/ingest/${operator}/events`).set(headers).send(raw);
};

beforeAll(async () => {
  api = await startTestApi('ingest');
  const identity = api.app.get(IdentityFacade);
  await identity.provisionTenant({ id: 'tenant-a', name: 'A', operator: 'casino-a', keyId: 'key-a', secret: 'secret-a' });
  await identity.provisionTenant({ id: 'tenant-b', name: 'B', operator: 'casino-b', keyId: 'key-b', secret: 'secret-b' });
});

afterAll(async () => {
  await api?.close();
});

beforeEach(async () => {
  await api.db.sql`truncate ingestion.envelope, ingestion.dedup, infra.outbox restart identity`;
});

const outbox = async () => api.db.sql`select * from infra.outbox order by id`;
const envelopes = async () => api.db.sql`select * from ingestion.envelope order by id`;

describe('ingestion — accepting a deposit', () => {
  it('S1 — a correctly signed deposit is accepted, stored and emitted exactly once', async () => {
    const res = await post(depositA('a-evt-1'));

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'accepted' });
    expect(res.body.eventId).toMatch(/[0-9a-f-]{36}/);

    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('casino.deposit.observed');
    expect(rows[0]!.tenant_id).toBe('tenant-a');
    expect(rows[0]!.payload).toMatchObject({
      operator: 'casino-a',
      operatorEventId: 'a-evt-1',
      externalPlayerId: 'player-77',
      amount: { amountMinor: 5000, currency: 'EUR' },
    });

    const stored = await envelopes();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.outcome).toBe('accepted');
    expect(stored[0]!.raw).toMatchObject({ event_id: 'a-evt-1', amount: '50.00' });
  });

  it('S2 — a replay returns the first event id and adds no second outbox row', async () => {
    const first = await post(depositA('a-evt-2'));
    const second = await post(depositA('a-evt-2', '999.00'));

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ status: 'duplicate', eventId: first.body.eventId });
    expect(await outbox()).toHaveLength(1);

    const stored = await envelopes();
    expect(stored).toHaveLength(2);
    expect(stored.map((e) => e.outcome)).toEqual(['accepted', 'duplicate']);
  });

  it('S3 — five concurrent duplicates produce one event', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, async () => post(depositA('a-evt-3'))));
    const ids = new Set(results.map((r) => r.body.eventId));

    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    expect(await outbox()).toHaveLength(1);
  });

  it('S7 — ingestion does not provision the player', async () => {
    await post(depositA('a-evt-4'));
    const players = await api.db.sql`select count(*)::int as n from identity.player`;
    expect(players[0]!.n).toBe(0);
  });
});

describe('ingestion — refusing what it should', () => {
  it('S4 — a bad signature, an unknown key and a stale timestamp are all 401 and alike', async () => {
    const badSecret = await post(depositA('x-1'), 'key-a', 'wrong-secret');
    const unknownKey = await post(depositA('x-2'), 'key-nope', 'secret-a');
    const stale = await post(depositA('x-3'), 'key-a', 'secret-a', 'casino-a', -4000);

    for (const res of [badSecret, unknownKey, stale]) {
      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    }
    expect(new Set([badSecret.body.type, unknownKey.body.type, stale.body.type]).size).toBe(1);
    expect(await envelopes()).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);
  });

  it('S4 — a request with no signature headers at all is 401', async () => {
    const res = await request(api.app.getHttpServer())
      .post('/v1/ingest/casino-a/events')
      .set('content-type', 'application/json')
      .send(JSON.stringify(depositA('x-4')));
    expect(res.status).toBe(401);
  });

  it('S5 — a malformed deposit is 422, names the field, and stores an invalid envelope', async () => {
    const res = await post({ ...depositA('a-evt-5'), user_id: '' });

    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/user_id/);
    expect(await outbox()).toHaveLength(0);
    const stored = await envelopes();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.outcome).toBe('invalid');
  });

  it('S6 — an event we do not act on is acknowledged, not refused', async () => {
    const res = await post({ ...depositA('a-evt-6'), event: 'withdrawal.completed' });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'ignored' });
    expect(await outbox()).toHaveLength(0);
    const stored = await envelopes();
    expect(stored[0]!.outcome).toBe('unsupported');
  });

  it('S5 — a body that is not JSON at all is refused without a crash', async () => {
    const now = Math.floor(api.clock.now().getTime() / 1000);
    const raw = 'this is not json';
    const res = await request(api.app.getHttpServer())
      .post('/v1/ingest/casino-a/events')
      .set('content-type', 'application/json')
      .set('x-mio-key-id', 'key-a')
      .set('x-mio-timestamp', String(now))
      .set('x-mio-signature', signed({}, 'key-a', 'secret-a', now).headers['x-mio-signature'])
      .send(raw);
    expect([400, 401, 422]).toContain(res.status);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  it('S9 — the module exposes no GET that writes', async () => {
    const before = await envelopes();
    const res = await request(api.app.getHttpServer()).get('/v1/ingest/casino-a/events');
    expect(res.status).toBe(404);
    expect(await envelopes()).toHaveLength(before.length);
  });
});

describe('ingestion — operator B speaks its own dialect through the same endpoint', () => {
  it('S1 — B envelope is accepted and produces the same canonical event', async () => {
    const body = {
      meta: { eventId: 'b-evt-1', type: 'PLAYER_DEPOSIT', emittedAt: '2026-11-20T11:00:00.000Z' },
      payload: { playerRef: 'player-77', amountCents: 5000, ccy: 'EUR' },
    };
    const res = await post(body, 'key-b', 'secret-b', 'casino-b');

    expect(res.status).toBe(202);
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      operator: 'casino-b',
      operatorEventId: 'b-evt-1',
      externalPlayerId: 'player-77',
      amount: { amountMinor: 5000, currency: 'EUR' },
    });
    expect(rows[0]!.tenant_id).toBe('tenant-b');
  });
});
