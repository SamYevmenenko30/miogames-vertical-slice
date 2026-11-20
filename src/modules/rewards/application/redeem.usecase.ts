import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../platform/clock/clock';
import type { UnitOfWork } from '../../../platform/db/unit-of-work';
import type { EventBusPort } from '../../../platform/events/outbox';
import { NotFoundError } from '../../../platform/http/errors';
import { REWARDS_REDEMPTION_REQUESTED } from '../../../contracts/events';
import type { LedgerFacade } from '../../ledger';
import type { Redemption } from '../domain/redemption';
import type { RedemptionRepositoryPort, StoreRepositoryPort } from './ports';

/**
 * One transaction: price the item, debit the coins, record the intent, emit the
 * event. The operator call is NOT in here — it belongs to the worker, because an
 * external call inside a transaction holds a database connection open for as
 * long as someone else's timeout.
 */
export class RedeemUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly store: StoreRepositoryPort,
    private readonly redemptions: RedemptionRepositoryPort,
    private readonly ledger: LedgerFacade,
    private readonly bus: EventBusPort,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    tenantId: string;
    playerId: string;
    itemId: string;
    idempotencyKey: string;
  }): Promise<{ redemption: Redemption; created: boolean }> {
    return this.uow.withTransaction(async () => {
      const item = await this.store.find(input.itemId);
      if (!item) throw new NotFoundError('store item', input.itemId);

      const now = this.clock.now();
      const { redemption, claimed } = await this.redemptions.create({
        id: randomUUID(),
        playerId: input.playerId,
        itemId: item.itemId,
        price: item.price,
        reward: item.reward,
        idempotencyKey: input.idempotencyKey,
        at: now,
      });
      if (!claimed) return { redemption, created: false };

      // The debit can still refuse (insufficient balance), which rolls the
      // redemption back with it — the whole point of one transaction.
      await this.ledger.debit({
        playerId: input.playerId,
        coins: item.price,
        reason: `redemption:${item.itemId}`,
        idempotencyKey: `redemption:${redemption.id}`,
      });

      await this.bus.publish({
        name: REWARDS_REDEMPTION_REQUESTED,
        tenantId: input.tenantId,
        aggregateType: 'redemption',
        aggregateId: redemption.id,
        payload: {
          redemptionId: redemption.id,
          playerId: input.playerId,
          itemId: item.itemId,
          reward: item.reward,
          requestedAt: now.toISOString(),
        },
      });

      return { redemption, created: true };
    });
  }
}
