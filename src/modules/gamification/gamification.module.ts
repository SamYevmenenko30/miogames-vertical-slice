import { Module } from '@nestjs/common';
import { AuditLog } from '../../platform/audit/audit-log';
import { UnitOfWork } from '../../platform/db/unit-of-work';
import { IdentityModule } from '../identity/identity.module';
import { CLOCK, type Clock } from '../../platform/clock/clock';
import { IdentityFacade } from '../identity';
import { AdminWheelsController } from './adapters/in/admin-wheels.controller';
import { DepositObservedConsumer } from './adapters/in/deposit-observed.consumer';
import { EntitlementRepository } from './adapters/out/entitlement.repository';
import { RewardRuleRepository } from './adapters/out/rule.repository';
import { WheelRepository } from './adapters/out/wheel.repository';
import { GrantEntitlementsUseCase } from './application/grant-entitlements.usecase';
import { WheelConfigService } from './application/wheel-config.service';

@Module({
  imports: [IdentityModule],
  controllers: [AdminWheelsController],
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
    {
      provide: DepositObservedConsumer,
      inject: [UnitOfWork, GrantEntitlementsUseCase],
      useFactory: (uow: UnitOfWork, grant: GrantEntitlementsUseCase) => new DepositObservedConsumer(uow, grant),
    },
  ],
  exports: [WheelConfigService, DepositObservedConsumer],
})
export class GamificationModule {}
