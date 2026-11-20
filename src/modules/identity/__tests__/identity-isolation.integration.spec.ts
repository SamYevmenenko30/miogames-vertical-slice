import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock } from '../../../platform/clock/clock';
import { createDatabase, type Database } from '../../../platform/db/database';
import { withTenant } from '../../../platform/db/tenant-context';
import { UnitOfWork } from '../../../platform/db/unit-of-work';
import { createTestDb, type TestDb } from '../../../test/db.helper';
import { PlayerRepository } from '../adapters/out/player.repository';
import { TenantRepository } from '../adapters/out/tenant.repository';
import { IdentityFacade } from '../application/identity.facade';
import { PlayerTokenService } from '../application/player-token.service';

let testDb: TestDb;
let database: Database;
let uow: UnitOfWork;
let identity: IdentityFacade;
let playerInA: string;

beforeAll(async () => {
  testDb = await createTestDb('identity-isolation');
  // arch-check: owner-role-isolation — the last case here authenticates key-a
  // while tenant-b is the ambient tenant, and asserts the key resolves its OWN
  // tenant. Under row-level security that lookup returns nothing instead (the
  // tenant_api_key policy restricts to the ambient tenant), so the application
  // guarantee — that `authenticate` never reads the ambient tenant — stops being
  // observable: a version that DID read it would also return null. The database
  // half of identity's isolation is covered by platform/db/row-level-security S9.
  database = createDatabase({ url: testDb.url });
  uow = new UnitOfWork(database);
  const clock = new FixedClock(new Date('2026-11-20T12:00:00.000Z'));
  const tokens = new PlayerTokenService('platform-player-token-secret-32ch', 3600, clock);
  identity = new IdentityFacade(uow, new TenantRepository(uow), new PlayerRepository(uow), tokens);

  await uow.withTransaction(async () => {
    const tenants = new TenantRepository(uow);
    await tenants.provisionTenant({ id: 'tenant-a', name: 'A', operator: 'casino-a', keyId: 'key-a', secret: 'secret-a' });
    await tenants.provisionTenant({ id: 'tenant-b', name: 'B', operator: 'casino-b', keyId: 'key-b', secret: 'secret-b' });
  });
  playerInA = await withTenant('tenant-a', async () => identity.ensurePlayer('player-in-a'));
});

afterAll(async () => {
  await database?.close();
  await testDb?.drop();
});

describe('identity — tenant isolation', () => {
  it("S12 — tenant B cannot read tenant A's player by internal id", async () => {
    expect(await withTenant('tenant-b', async () => identity.findPlayerById(playerInA))).toBeNull();
    expect(await withTenant('tenant-a', async () => identity.findPlayerById(playerInA))).not.toBeNull();
  });

  it("S12 — tenant B cannot read tenant A's player by external id", async () => {
    expect(await withTenant('tenant-b', async () => identity.findPlayerByExternalId('player-in-a'))).toBeNull();
  });

  it("S12 — a token minted for tenant A does not resolve a player under tenant B", async () => {
    const token = await withTenant('tenant-a', async () => identity.issuePlayerToken(playerInA));
    const claims = identity.verifyPlayerToken(token);
    expect(claims.tenantId).toBe('tenant-a');
    // The claims name tenant A, so a resolution under tenant B finds nothing.
    expect(await withTenant('tenant-b', async () => identity.findPlayerById(claims.playerId))).toBeNull();
  });

  it('S12 — authenticating with a key resolves that key own tenant, never the ambient one', async () => {
    const underB = await withTenant('tenant-b', async () => identity.authenticate('key-a', 'secret-a'));
    expect(underB).toMatchObject({ tenantId: 'tenant-a' });
  });
});
