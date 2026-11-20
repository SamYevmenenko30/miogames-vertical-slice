import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdentityFacade } from '../../identity';
import { startTestApi, type TestApi } from '../../../test/api.helper';

let api: TestApi;

const slices = [
  { id: 'small', weight: 50, prize: { kind: 'coins', amount: 10 } },
  { id: 'big', weight: 50, prize: { kind: 'coins', amount: 100 } },
];

beforeAll(async () => {
  api = await startTestApi('gamification-isolation');
  const identity = api.app.get(IdentityFacade);
  await identity.provisionTenant({ id: 'tenant-a', name: 'A', operator: 'casino-a', keyId: 'key-a', secret: 'secret-a' });
  await identity.provisionTenant({ id: 'tenant-b', name: 'B', operator: 'casino-b', keyId: 'key-b', secret: 'secret-b' });
  await request(api.app.getHttpServer())
    .put('/v1/admin/wheels/welcome')
    .set('authorization', 'Bearer key-a.secret-a')
    .send({ name: 'A wheel', slices });
});

afterAll(async () => {
  await api?.close();
});

describe('gamification — tenant isolation', () => {
  it("S7 — tenant B cannot read tenant A's wheel", async () => {
    const res = await request(api.app.getHttpServer())
      .get('/v1/admin/wheels/welcome')
      .set('authorization', 'Bearer key-b.secret-b');
    expect(res.status).toBe(404);
  });

  it("S7 — tenant B writing the same wheel id creates its OWN version 1", async () => {
    const res = await request(api.app.getHttpServer())
      .put('/v1/admin/wheels/welcome')
      .set('authorization', 'Bearer key-b.secret-b')
      .send({ name: 'B wheel', slices: [{ ...slices[0], weight: 1 }, slices[1]] });
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(1);

    const a = await request(api.app.getHttpServer())
      .get('/v1/admin/wheels/welcome')
      .set('authorization', 'Bearer key-a.secret-a');
    expect(a.body.slices).toEqual(slices);

    const rows = await api.db.sql`select tenant_id, version from gamification.wheel_version order by tenant_id`;
    expect(rows).toEqual([
      { tenant_id: 'tenant-a', version: 1 },
      { tenant_id: 'tenant-b', version: 1 },
    ]);
  });
});

describe('gamification — a spin cannot cross a tenant', () => {
  it("S11 — a token minted for tenant A does not consume tenant B's entitlements", async () => {
    const created = await request(api.app.getHttpServer())
      .post('/v1/sessions')
      .set('authorization', 'Bearer key-a.secret-a')
      .send({ externalPlayerId: 'shared-player' });
    expect(created.status).toBe(200);

    // Tenant B has an entitlement for ITS player with the same external id.
    await request(api.app.getHttpServer())
      .post('/v1/sessions')
      .set('authorization', 'Bearer key-b.secret-b')
      .send({ externalPlayerId: 'shared-player' });
    const bPlayer = await api.db.sql`
      select player_id from identity.player_identity
       where tenant_id = 'tenant-b' and external_player_id = 'shared-player'`;
    await api.db.sql`insert into gamification.wheel (tenant_id, id, name) values ('tenant-b', 'welcome', 'W')
      on conflict do nothing`;
    await api.db.sql`insert into gamification.wheel_version (tenant_id, wheel_id, version, slices, created_by)
      values ('tenant-b', 'welcome', 1, ${api.db.sql.json([
        { id: 'small', weight: 1, prize: { kind: 'coins', amount: 10 } },
        { id: 'big', weight: 1, prize: { kind: 'coins', amount: 20 } },
      ])}, 'test') on conflict do nothing`;
    await api.db.sql`
      insert into gamification.spin_entitlement
        (id, tenant_id, player_id, wheel_id, wheel_version, rule_id, state, server_seed, seed_hash,
         source_event_id, granted_at, expires_at)
      values (${crypto.randomUUID()}, 'tenant-b', ${bPlayer[0]!.player_id}, 'welcome', 1, 'r', 'granted',
              ${'c'.repeat(64)}, 'hash', 'evt', now(), now() + interval '1 day')`;

    const res = await request(api.app.getHttpServer())
      .post('/v1/spins')
      .set('authorization', `Bearer ${created.body.token}`)
      .send({});

    expect(res.status).toBe(409);
    const rows = await api.db.sql`select state from gamification.spin_entitlement where tenant_id = 'tenant-b'`;
    expect(rows[0]!.state).toBe('granted');
  });
});
