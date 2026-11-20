import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../platform/clock/clock';
import { UnitOfWork } from '../../platform/db/unit-of-work';
import { EVENT_BUS, type EventBusPort } from '../../platform/events/outbox';
import { IdentityModule } from '../identity/identity.module';
import { LedgerFacade } from '../ledger';
import { LedgerModule } from '../ledger/ledger.module';
import { RedemptionController } from './adapters/in/redemption.controller';
import { RedemptionRepository } from './adapters/out/redemption.repository';
import { StoreRepository } from './adapters/out/store.repository';
import { RedeemUseCase } from './application/redeem.usecase';
import { RewardsFacade } from './application/rewards.facade';

@Module({
  imports: [IdentityModule, LedgerModule],
  controllers: [RedemptionController],
  providers: [
    { provide: StoreRepository, inject: [UnitOfWork], useFactory: (uow: UnitOfWork) => new StoreRepository(uow) },
    {
      provide: RedemptionRepository,
      inject: [UnitOfWork],
      useFactory: (uow: UnitOfWork) => new RedemptionRepository(uow),
    },
    {
      provide: RedeemUseCase,
      inject: [UnitOfWork, StoreRepository, RedemptionRepository, LedgerFacade, EVENT_BUS, CLOCK],
      useFactory: (
        uow: UnitOfWork,
        store: StoreRepository,
        redemptions: RedemptionRepository,
        ledger: LedgerFacade,
        bus: EventBusPort,
        clock: Clock,
      ) => new RedeemUseCase(uow, store, redemptions, ledger, bus, clock),
    },
    {
      provide: RewardsFacade,
      inject: [UnitOfWork, StoreRepository, RedemptionRepository],
      useFactory: (uow: UnitOfWork, store: StoreRepository, redemptions: RedemptionRepository) =>
        new RewardsFacade(uow, store, redemptions),
    },
  ],
  exports: [RewardsFacade, RedeemUseCase],
})
export class RewardsModule {}
