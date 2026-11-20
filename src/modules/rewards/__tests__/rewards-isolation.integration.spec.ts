import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../../platform/db/tenant-context';
import { startTestApi, type TestApi } from '../../../test/api.helper';
import { IdentityFacade } from '../../identity';
import { LedgerFacade } from '../../ledger';

let api: TestApi;
let tokenA: string;
let tokenB: string;
let redemptionInA: string;

const topUp = async (external: string, tenant: string) => {
  const rows = await api.db.sql`
    select player_id from identity.player_identity where tenant_id = ${tenant} and external_player_id = ${external}`;
  const ledger = api.app.get(LedgerFacade);
  await withTenant(tenant, async () =>
    ledger.credit({
      playerId: rows[0]!.player_id as string,
      coins: 500,
      reason: 'test.topup',
      idempotencyKey: `topup-${tenant}`,
    }),
  );
};

beforeAll(async () => {
  api = await startTestApi('rewards-isolation');
  const identity = api.app.get(IdentityFacade);
  await identity.provisionTenant({ id: 'tenant-a', name: 'A', operator: 'casino-a', keyId: 'key-a', secret: 'secret-a' });
  await identity.provisionTenant({ id: 'tenant-b', name: 'B', operator: 'casino-b', keyId: 'key-b', secret: 'secret-b' });

  for (const [tenant, key] of [['tenant-a', 'key-a.secret-a'], ['tenant-b', 'key-b.secret-b']] as const) {
    await request(api.app.getHttpServer())
      .put('/v1/admin/store-items/spins-50')
      .set('authorization', `Bearer ${key}`)
      .send({ price: 100, reward: { kind: 'free_spins', count: 50 }, name: '50 spins' });
    const created = await request(api.app.getHttpServer())
      .post('/v1/sessions')
      .set('authorization', `Bearer ${key}`)
      .send({ externalPlayerId: 'shared-player' });
    if (tenant === 'tenant-a') tokenA = created.body.token;
    else tokenB = created.body.token;
    await topUp('shared-player', tenant);
  }

  const created = await request(api.app.getHttpServer())
    .post('/v1/redemptions')
    .set('authorization', `Bearer ${tokenA}`)
    .set('idempotency-key', 'shared-key')
    .send({ itemId: 'spins-50' });
  redemptionInA = created.body.redemptionId;
});

afterAll(async () => {
  await api?.close();
});

describe('rewards — tenant isolation', () => {
  it("S10 — tenant B cannot read tenant A's redemption", async () => {
    const res = await request(api.app.getHttpServer())
      .get(`/v1/redemptions/${redemptionInA}`)
      .set('authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it('S10 — the same Idempotency-Key in two tenants is two redemptions', async () => {
    const res = await request(api.app.getHttpServer())
      .post('/v1/redemptions')
      .set('authorization', `Bearer ${tokenB}`)
      .set('idempotency-key', 'shared-key')
      .send({ itemId: 'spins-50' });

    expect(res.status).toBe(202);
    expect(res.body.redemptionId).not.toBe(redemptionInA);
    const rows = await api.db.sql`select tenant_id from rewards.redemption order by tenant_id`;
    expect(rows.map((r) => r.tenant_id)).toEqual(['tenant-a', 'tenant-b']);
  });
});
