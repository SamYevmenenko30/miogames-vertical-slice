import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IdentityFacade } from '../../identity';
import { startTestApi, type TestApi } from '../../../test/api.helper';

let api: TestApi;

const slices = [
  { id: 'small', weight: 50, prize: { kind: 'coins', amount: 10 } },
  { id: 'medium', weight: 30, prize: { kind: 'coins', amount: 50 } },
  { id: 'jackpot', weight: 20, prize: { kind: 'free_spins', count: 10 } },
];

const put = (wheelId: string, body: object, key = 'key-a.secret-a') =>
  request(api.app.getHttpServer())
    .put(`/v1/admin/wheels/${wheelId}`)
    .set('authorization', `Bearer ${key}`)
    .send(body);

const get = (wheelId: string, query = '', key = 'key-a.secret-a') =>
  request(api.app.getHttpServer())
    .get(`/v1/admin/wheels/${wheelId}${query}`)
    .set('authorization', `Bearer ${key}`);

beforeAll(async () => {
  api = await startTestApi('wheel-admin');
  const identity = api.app.get(IdentityFacade);
  await identity.provisionTenant({ id: 'tenant-a', name: 'A', operator: 'casino-a', keyId: 'key-a', secret: 'secret-a' });
});

afterAll(async () => {
  await api?.close();
});

beforeEach(async () => {
  await api.db.sql`truncate gamification.wheel_version, gamification.wheel cascade`;
  // TRUNCATE, not DELETE: infra.audit_log is append-only and the trigger refuses
  // a DELETE. The real production control is that the application role holds no
  // TRUNCATE privilege — see TD-0010 and MIO-011.
  await api.db.sql`truncate infra.audit_log`;
});

describe('gamification — wheel configuration', () => {
  it('S1 — creating a wheel creates version 1 and reads back its slices', async () => {
    const created = await put('welcome', { name: 'Welcome wheel', slices });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ wheelId: 'welcome', version: 1 });

    const read = await get('welcome');
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ wheelId: 'welcome', version: 1 });
    expect(read.body.slices).toEqual(slices);
  });

  it('S2 — a change creates version 2 and leaves version 1 readable', async () => {
    await put('welcome', { name: 'Welcome wheel', slices });
    const changed = await put('welcome', {
      name: 'Welcome wheel',
      slices: [...slices.slice(0, 2), { id: 'jackpot', weight: 1, prize: { kind: 'free_spins', count: 100 } }],
    });
    expect(changed.body.version).toBe(2);

    const rows = await api.db.sql`select version from gamification.wheel_version order by version`;
    expect(rows.map((r) => r.version)).toEqual([1, 2]);

    const old = await get('welcome', '?version=1');
    expect(old.body.version).toBe(1);
    expect(old.body.slices).toEqual(slices);
  });

  it('S3 — the live version is the highest', async () => {
    await put('welcome', { name: 'w', slices });
    await put('welcome', { name: 'w', slices });
    const live = await get('welcome');
    expect(live.body.version).toBe(2);
  });

  it('S4 — each kind of invalid configuration is refused, and creates no version', async () => {
    const bad: Array<[string, object, RegExp]> = [
      ['one slice', { name: 'w', slices: [slices[0]] }, /two/i],
      ['zero weight', { name: 'w', slices: [{ ...slices[0], weight: 0 }, slices[1]] }, /weight/i],
      ['fractional weight', { name: 'w', slices: [{ ...slices[0], weight: 1.5 }, slices[1]] }, /integer/i],
      ['duplicate id', { name: 'w', slices: [slices[0], { ...slices[1], id: 'small' }] }, /duplicate/i],
      ['unknown prize', { name: 'w', slices: [{ id: 'x', weight: 1, prize: { kind: 'yacht' } }, slices[1]] }, /prize|kind/i],
      ['coins zero', { name: 'w', slices: [{ id: 'x', weight: 1, prize: { kind: 'coins', amount: 0 } }, slices[1]] }, /amount/i],
      ['no slices at all', { name: 'w' }, /slices/i],
    ];

    for (const [label, body, reason] of bad) {
      const res = await put('welcome', body);
      expect(res.status, label).toBe(422);
      expect(res.body.detail, label).toMatch(reason);
    }
    const rows = await api.db.sql`select count(*)::int as n from gamification.wheel_version`;
    expect(rows[0]!.n).toBe(0);
  });

  it('S5 — a successful write is audited with the actor and the version', async () => {
    await put('welcome', { name: 'w', slices });
    const rows = await api.db.sql`select * from infra.audit_log where action = 'wheel.version.created'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe('admin:key-a');
    expect(rows[0]!.subject_id).toBe('welcome');
    expect(rows[0]!.data).toMatchObject({ version: 1 });
  });

  it('S5 — a refused write is not audited', async () => {
    await put('welcome', { name: 'w', slices: [slices[0]] });
    const rows = await api.db.sql`select count(*)::int as n from infra.audit_log where action = 'wheel.version.created'`;
    expect(rows[0]!.n).toBe(0);
  });

  it('S1 — unauthenticated admin requests are refused', async () => {
    const noHeader = await request(api.app.getHttpServer()).put('/v1/admin/wheels/welcome').send({ name: 'w', slices });
    const wrongSecret = await put('welcome', { name: 'w', slices }, 'key-a.wrong');
    const malformed = await put('welcome', { name: 'w', slices }, 'nonsense');
    for (const res of [noHeader, wrongSecret, malformed]) {
      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    }
  });

  it('S3 — an unknown wheel is 404', async () => {
    const res = await get('does-not-exist');
    expect(res.status).toBe(404);
  });
});
