import { Module } from '@nestjs/common';
import { AuditLog } from '../../platform/audit/audit-log';
import { UnitOfWork } from '../../platform/db/unit-of-work';
import { EVENT_BUS, type EventBusPort } from '../../platform/events/outbox';
import { IdentityModule } from '../identity/identity.module';
import { CLOCK, type Clock } from '../../platform/clock/clock';
import { IdentityFacade } from '../identity';
import { LedgerFacade } from '../ledger';
import { LedgerModule } from '../ledger/ledger.module';
import { AdminWheelsController } from './adapters/in/admin-wheels.controller';
import { DepositObservedConsumer } from './adapters/in/deposit-observed.consumer';
import { GAMIFICATION_EVENT_HANDLERS, type GamificationEventHandlers } from './application/ports';
import { SpinController } from './adapters/in/spin.controller';
import { EntitlementRepository } from './adapters/out/entitlement.repository';
import { SpinRepository } from './adapters/out/spin.repository';
import { SpinUseCase } from './application/spin.usecase';
import { RewardRuleRepository } from './adapters/out/rule.repository';
import { WheelRepository } from './adapters/out/wheel.repository';
import { GrantEntitlementsUseCase } from './application/grant-entitlements.usecase';
import { WheelConfigService } from './application/wheel-config.service';

@Module({
  imports: [IdentityModule, LedgerModule],
  controllers: [AdminWheelsController, SpinController],
  providers: [
    { provide: WheelRepository, inject: [UnitOfWork], useFactory: (uow: UnitOfWork) => new WheelRepository(uow) },
    {
      provide: WheelConfigService,
      inject: [UnitOfWork, WheelRepository, AuditLog],
      useFactory: (uow: UnitOfWork, wheels: WheelRepository, audit: AuditLog) =>
        new WheelConfigService(uow, wheels, audit),
    },
    {
      provide: RewardRuleRepository,
      inject: [UnitOfWork],
      useFactory: (uow: UnitOfWork) => new RewardRuleRepository(uow),
    },
    {
      provide: EntitlementRepository,
      inject: [UnitOfWork],
      useFactory: (uow: UnitOfWork) => new EntitlementRepository(uow),
    },
    {
      provide: GrantEntitlementsUseCase,
      inject: [UnitOfWork, IdentityFacade, RewardRuleRepository, WheelRepository, EntitlementRepository, CLOCK],
      useFactory: (
        uow: UnitOfWork,
        identity: IdentityFacade,
        rules: RewardRuleRepository,
        wheels: WheelRepository,
        entitlements: EntitlementRepository,
        clock: Clock,
      ) => new GrantEntitlementsUseCase(uow, identity, rules, wheels, entitlements, clock),
    },
    { provide: SpinRepository, inject: [UnitOfWork], useFactory: (uow: UnitOfWork) => new SpinRepository(uow) },
    {
      provide: SpinUseCase,
      inject: [UnitOfWork, EntitlementRepository, WheelRepository, SpinRepository, LedgerFacade, EVENT_BUS, CLOCK],
      useFactory: (
        uow: UnitOfWork,
        entitlements: EntitlementRepository,
        wheels: WheelRepository,
        spins: SpinRepository,
        ledger: LedgerFacade,
        bus: EventBusPort,
        clock: Clock,
      ) => new SpinUseCase(uow, entitlements, wheels, spins, ledger, bus, clock),
    },
    {
      provide: DepositObservedConsumer,
      inject: [UnitOfWork, GrantEntitlementsUseCase],
      useFactory: (uow: UnitOfWork, grant: GrantEntitlementsUseCase) => new DepositObservedConsumer(uow, grant),
    },
    {
      // The handlers as a VALUE, so a composition root never names the adapter.
      provide: GAMIFICATION_EVENT_HANDLERS,
      inject: [DepositObservedConsumer],
      useFactory: (deposits: DepositObservedConsumer): GamificationEventHandlers => [deposits],
    },
  ],
  exports: [WheelConfigService, SpinUseCase, GAMIFICATION_EVENT_HANDLERS],
})
export class GamificationModule {}
