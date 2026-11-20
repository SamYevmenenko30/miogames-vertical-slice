import type { UnitOfWork } from '../../../platform/db/unit-of-work';
import type { Redemption, StoreItem } from '../domain/redemption';
import type { RedemptionRepositoryPort, StoreRepositoryPort } from './ports';

export class RewardsFacade {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly store: StoreRepositoryPort,
    private readonly redemptions: RedemptionRepositoryPort,
  ) {}

  async upsertStoreItem(item: StoreItem): Promise<void> {
    await this.uow.withTransaction(async () => this.store.upsert(item));
  }

  async listStoreItems(): Promise<StoreItem[]> {
    return this.uow.withTransaction(async () => this.store.list());
  }

  async redemptionForPlayer(id: string, playerId: string): Promise<Redemption | null> {
    return this.uow.withTransaction(async () => this.redemptions.findForPlayer(id, playerId));
  }
}
