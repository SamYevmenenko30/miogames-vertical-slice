import { and, eq } from 'drizzle-orm';
import { scopedWhere } from '../../../../platform/db/scoped';
import { currentTenantId } from '../../../../platform/db/tenant-context';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import type { StoreRepositoryPort } from '../../application/ports';
import type { RewardPayload, StoreItem } from '../../domain/redemption';
import { storeItem } from './rewards.schema';

export class StoreRepository implements StoreRepositoryPort {
  constructor(private readonly uow: UnitOfWork) {}

  async upsert(item: StoreItem): Promise<void> {
    await this.uow.tx
      .insert(storeItem)
      .values({ tenantId: currentTenantId(), ...item })
      .onConflictDoUpdate({
        target: [storeItem.tenantId, storeItem.itemId],
        set: { name: item.name, price: item.price, reward: item.reward, active: true },
      });
  }

  async list(): Promise<StoreItem[]> {
    const rows = await this.uow.tx
      .select()
      .from(storeItem)
      .where(scopedWhere(storeItem, eq(storeItem.active, true)));
    return rows.map(toItem);
  }

  async find(itemId: string): Promise<StoreItem | null> {
    const rows = await this.uow.tx
      .select()
      .from(storeItem)
      .where(and(scopedWhere(storeItem), eq(storeItem.itemId, itemId), eq(storeItem.active, true)))
      .limit(1);
    return rows[0] ? toItem(rows[0]) : null;
  }
}

function toItem(row: { itemId: string; name: string; price: number; reward: unknown }): StoreItem {
  return { itemId: row.itemId, name: row.name, price: Number(row.price), reward: row.reward as RewardPayload };
}
