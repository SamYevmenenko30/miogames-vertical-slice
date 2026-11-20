import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { IdentityFacade } from '../../identity';
import { signed, startTestApi, type TestApi } from '../../../test/api.helper';

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi('ingestion-isolation');
  const identity = api.app.get(IdentityFacade);
  await identity.provisionTenant({ id: 'tenant-a', name: 'A', operator: 'casino-a', keyId: 'key-a', secret: 'secret-a' });
  await identity.provisionTenant({ id: 'tenant-b', name: 'B', operator: 'casino-a', keyId: 'key-b', secret: 'secret-b' });
});

afterAll(async () => {
  await api?.close();
});

describe('ingestion — tenant isolation', () => {
  it("S8 — an event signed with tenant B's key lands under tenant B, whatever it names", async () => {
    const body = {
      event: 'deposit.completed',
      event_id: 'shared-id',
      user_id: 'player-77',
      amount: '50.00',
      currency: 'EUR',
      occurred_at: '2026-11-20T11:00:00.000Z',
    };
    const now = Math.floor(api.clock.now().getTime() / 1000);

    const b = signed(body, 'key-b', 'secret-b', now);
    const res = await request(api.app.getHttpServer())
      .post('/v1/ingest/casino-a/events')
      .set(b.headers)
      .send(b.raw);
    expect(res.status).toBe(202);

    const rows = await api.db.sql`select tenant_id from infra.outbox`;
    expect(rows.map((r) => r.tenant_id)).toEqual(['tenant-b']);
    const forA = await api.db.sql`select count(*)::int as n from ingestion.envelope where tenant_id = 'tenant-a'`;
    expect(forA[0]!.n).toBe(0);
  });

  it('S8 — the same operator event id in two tenants is two events, not a duplicate', async () => {
    const body = (id: string) => ({
      event: 'deposit.completed',
      event_id: id,
      user_id: 'player-99',
      amount: '20.00',
      currency: 'EUR',
      occurred_at: '2026-11-20T11:00:00.000Z',
    });
    const now = Math.floor(api.clock.now().getTime() / 1000);
    const send = (keyId: string, secret: string) => {
      const s = signed(body('same-across-tenants'), keyId, secret, now);
      return request(api.app.getHttpServer()).post('/v1/ingest/casino-a/events').set(s.headers).send(s.raw);
    };

    const first = await send('key-a', 'secret-a');
    const second = await send('key-b', 'secret-b');

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(first.body.eventId).not.toBe(second.body.eventId);
  });
});
