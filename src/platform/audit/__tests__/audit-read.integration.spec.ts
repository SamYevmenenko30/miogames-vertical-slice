import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdentityFacade } from '../../../modules/identity';
import { startTestApi, type TestApi } from '../../../test/api.helper';

let api: TestApi;

const slices = [
  { id: 'a', weight: 1, prize: { kind: 'coins', amount: 10 } },
  { id: 'b', weight: 1, prize: { kind: 'nothing' } },
];

const putWheel = (wheelId: string, key: string) =>
  request(api.app.getHttpServer())
    .put(`/v1/admin/wheels/${wheelId}`)
    .set('authorization', `Bearer ${key}`)
    .send({ name: wheelId, slices });

const readAudit = (key: string) =>
  request(api.app.getHttpServer()).get('/v1/admin/audit').set('authorization', `Bearer ${key}`);

beforeAll(async () => {
  api = await startTestApi('audit-read');
  const identity = api.app.get(IdentityFacade);
  await identity.provisionTenant({ id: 'tenant-a', name: 'A', operator: 'casino-a', keyId: 'key-a', secret: 'secret-a' });
  await identity.provisionTenant({ id: 'tenant-b', name: 'B', operator: 'casino-b', keyId: 'key-b', secret: 'secret-b' });

  await putWheel('welcome', 'key-a.secret-a');
  await putWheel('welcome', 'key-a.secret-a');
  await putWheel('welcome', 'key-b.secret-b');
});

afterAll(async () => {
  await api?.close();
});

describe('platform/audit — reading the log', () => {
  it('S4 — the tenant own entries come back newest first, with the actor and the subject', async () => {
    const res = await readAudit('key-a.secret-a');
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBe(2);

    const [newest, oldest] = res.body.entries as Array<Record<string, unknown>>;
    expect(newest).toMatchObject({
      action: 'wheel.version.created',
      actor: 'admin:key-a',
      subjectType: 'wheel',
      subjectId: 'welcome',
    });
    expect((newest!.data as { version: number }).version).toBe(2);
    expect((oldest!.data as { version: number }).version).toBe(1);
  });

  it('S5 — another tenant entries are not in it, for the same action', async () => {
    const forA = await readAudit('key-a.secret-a');
    const forB = await readAudit('key-b.secret-b');

    expect(forA.body.entries).toHaveLength(2);
    expect(forB.body.entries).toHaveLength(1);
    expect((forB.body.entries as Array<{ actor: string }>).every((e) => e.actor === 'admin:key-b')).toBe(true);
  });

  it('S5 — an unauthenticated read is refused', async () => {
    const res = await request(api.app.getHttpServer()).get('/v1/admin/audit');
    expect(res.status).toBe(401);
  });
});
