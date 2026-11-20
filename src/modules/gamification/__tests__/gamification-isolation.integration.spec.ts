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
