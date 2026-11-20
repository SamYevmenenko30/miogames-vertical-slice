import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../../platform/clock/clock';
import { createDatabase, type Database } from '../../../platform/db/database';
import { withTenant } from '../../../platform/db/tenant-context';
import { UnitOfWork } from '../../../platform/db/unit-of-work';
import { createTestDb, type TestDb } from '../../../test/db.helper';
import { IdentityFacade } from '../application/identity.facade';
import { TenantRepository } from '../adapters/out/tenant.repository';
import { PlayerRepository } from '../adapters/out/player.repository';
import { PlayerTokenService } from '../application/player-token.service';

let testDb: TestDb;
let database: Database;
let uow: UnitOfWork;
let identity: IdentityFacade;

const seedTenant = async (id: string, keyId: string, secret: string) => {
  await uow.withTransaction(async () =>
    new TenantRepository(uow).provisionTenant({
      id,
      name: id,
      operator: id === 'tenant-a' ? 'casino-a' : 'casino-b',
      keyId,
      secret,
    }),
  );
};

beforeAll(async () => {
  testDb = await createTestDb('identity');
  // The OWNER on purpose: this file seeds and asserts on credential rows whose
  // policies deliberately allow a row through before any tenant is established.
  // The isolation half is proved as the application role, next door.
  database = createDatabase({ url: testDb.url });
  uow = new UnitOfWork(database);
  const clock = new FixedClock(new Date('2026-11-20T12:00:00.000Z'));
  identity = new IdentityFacade(
    uow,
    new TenantRepository(uow),
    new PlayerRepository(uow),
    new PlayerTokenService('platform-player-token-secret-32ch', 3600, clock),
  );
});

afterAll(async () => {
  await database?.close();
  await testDb?.drop();
});

beforeEach(async () => {
  await testDb.sql`truncate identity.player_identity, identity.player, identity.tenant_api_key, identity.tenant cascade`;
  await seedTenant('tenant-a', 'key-a', 'secret-a');
  await seedTenant('tenant-b', 'key-b', 'secret-b');
});

describe('identity — authenticating an operator', () => {
  it('S1 — an active key id and its secret resolve to the tenant', async () => {
    const result = await identity.authenticate('key-a', 'secret-a');
    expect(result).toMatchObject({ tenantId: 'tenant-a', operator: 'casino-a' });
  });

  it('S2 — a wrong secret, an unknown key and a deactivated key are indistinguishable', async () => {
    const wrongSecret = await identity.authenticate('key-a', 'not-the-secret');
    const unknownKey = await identity.authenticate('key-does-not-exist', 'secret-a');
    await uow.withTransaction(async () => new TenantRepository(uow).deactivateKey('key-b'));
    const deactivated = await identity.authenticate('key-b', 'secret-b');

    expect(wrongSecret).toBeNull();
    expect(unknownKey).toBeNull();
    expect(deactivated).toBeNull();
  });

  it('S3 — no column holds the secret in the clear', async () => {
    const rows = await testDb.sql`select * from identity.tenant_api_key where key_id = 'key-a'`;
    const serialised = JSON.stringify(rows[0]);
    expect(serialised).not.toContain('secret-a');
    expect(await identity.authenticate('key-a', 'secret-a')).not.toBeNull();
  });

  it('S4 — deactivating a key leaves the tenant alone', async () => {
    await uow.withTransaction(async () => new TenantRepository(uow).deactivateKey('key-a'));
    expect(await identity.authenticate('key-a', 'secret-a')).toBeNull();
    const tenants = await testDb.sql`select count(*)::int as n from identity.tenant where id = 'tenant-a'`;
    expect(tenants[0]!.n).toBe(1);
  });
});

describe('identity — players', () => {
  it('S5 — a player is provisioned on first sight, with one identity row', async () => {
    const playerId = await withTenant('tenant-a', async () => identity.ensurePlayer('player-77'));
    expect(playerId).toMatch(/.+/);

    const players = await testDb.sql`select count(*)::int as n from identity.player`;
    const identities = await testDb.sql`select count(*)::int as n from identity.player_identity`;
    expect(players[0]!.n).toBe(1);
    expect(identities[0]!.n).toBe(1);
  });

  it('S6 — provisioning twice returns the same player and leaves one identity row', async () => {
    const first = await withTenant('tenant-a', async () => identity.ensurePlayer('player-77'));
    const second = await withTenant('tenant-a', async () => identity.ensurePlayer('player-77'));
    expect(second).toBe(first);
    const identities = await testDb.sql`select count(*)::int as n from identity.player_identity`;
    expect(identities[0]!.n).toBe(1);
  });

  it('S6 — two concurrent first-sights still yield one player', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, async () => withTenant('tenant-a', async () => identity.ensurePlayer('player-88'))),
    );
    expect(new Set(results).size).toBe(1);
    const players = await testDb.sql`select count(*)::int as n from identity.player`;
    expect(players[0]!.n).toBe(1);
  });

  it('S7 — the same external id in two tenants is two different players', async () => {
    const inA = await withTenant('tenant-a', async () => identity.ensurePlayer('player-77'));
    const inB = await withTenant('tenant-b', async () => identity.ensurePlayer('player-77'));
    expect(inA).not.toBe(inB);

    const seenFromB = await withTenant('tenant-b', async () => identity.findPlayerById(inA));
    expect(seenFromB).toBeNull();
  });

  it('S8 — a lookup never creates', async () => {
    const found = await withTenant('tenant-a', async () => identity.findPlayerByExternalId('never-seen'));
    expect(found).toBeNull();
    const players = await testDb.sql`select count(*)::int as n from identity.player`;
    expect(players[0]!.n).toBe(0);
  });
});
