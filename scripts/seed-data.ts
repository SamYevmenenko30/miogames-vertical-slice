import { sql } from 'drizzle-orm';
import type { IdentityFacade } from '../src/modules/identity';
import { withTenant } from '../src/platform/db/tenant-context';
import type { UnitOfWork } from '../src/platform/db/unit-of-work';
import type { WheelConfigService } from '../src/modules/gamification';
import type { RewardsFacade } from '../src/modules/rewards';

/**
 * The two simulated operators as tenants, with a wheel, a rule and a store item
 * each. Used by `pnpm db:seed` and by the smoke run, so the two cannot drift.
 */
export const TENANTS = [
  { id: 'tenant-a', name: 'Casino Platform A', operator: 'casino-a', keyId: 'key-casino-a', secret: 'secret-casino-a' },
  { id: 'tenant-b', name: 'Casino Platform B', operator: 'casino-b', keyId: 'key-casino-b', secret: 'secret-casino-b' },
] as const;

export const WHEEL_SLICES = [
  { id: 'coins-10', weight: 45, prize: { kind: 'coins', amount: 10 } },
  { id: 'coins-50', weight: 30, prize: { kind: 'coins', amount: 50 } },
  { id: 'coins-200', weight: 15, prize: { kind: 'coins', amount: 200 } },
  { id: 'free-spins-10', weight: 7, prize: { kind: 'free_spins', count: 10 } },
  { id: 'jackpot', weight: 3, prize: { kind: 'bonus_cash', amountMinor: 2000, currency: 'EUR' } },
] as const;

export const STORE_ITEM = {
  itemId: 'free-spins-50',
  name: '50 free spins',
  price: 100,
  reward: { kind: 'free_spins' as const, count: 50 },
};

export async function seedEverything(deps: {
  identity: IdentityFacade;
  wheels: WheelConfigService;
  rewards: RewardsFacade;
  uow: UnitOfWork;
}): Promise<void> {
  for (const tenant of TENANTS) {
    await deps.identity.provisionTenant({ ...tenant });

    await withTenant(tenant.id, async () => {
      await deps.wheels.createVersion({
        tenantId: tenant.id,
        wheelId: 'welcome',
        name: 'Welcome wheel',
        slices: WHEEL_SLICES.map((slice) => ({ ...slice, prize: { ...slice.prize } })),
        actor: 'seed',
      });
      await deps.rewards.upsertStoreItem({ ...STORE_ITEM });
      // Rules are rows: "deposit >= 20 EUR -> 2 spins of welcome", seven-day TTL.
      await deps.uow.withTransaction(async () =>
        deps.uow.tx.execute(sql`
          insert into gamification.reward_rule
            (tenant_id, id, min_deposit_minor, currency, wheel_id, spins, ttl_hours)
          values (${tenant.id}, 'welcome-bronze', 2000, 'EUR', 'welcome', 2, 168)
          on conflict (tenant_id, id) do update set spins = 2`),
      );
    });
  }
}
