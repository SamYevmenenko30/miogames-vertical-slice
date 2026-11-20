import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../platform/clock/clock';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config';
import { LOGGER, type Logger } from '../../platform/observability/logger';
import { JobUnitOfWork, UnitOfWork } from '../../platform/db/unit-of-work';
import { EVENT_BUS, type EventBusPort } from '../../platform/events/outbox';
import { IdentityFacade } from '../identity';
import { IdentityModule } from '../identity/identity.module';
import { IntegrationFacade } from '../integration';
import { IntegrationModule } from '../integration/integration.module';
import { LedgerFacade } from '../ledger';
import { LedgerModule } from '../ledger/ledger.module';
import { IssueRedemptionConsumer } from './adapters/in/issue-redemption.consumer';
import { REWARDS_EVENT_HANDLERS, type RewardsEventHandlers } from './application/ports';
import { RedemptionController } from './adapters/in/redemption.controller';
import { IssuanceWorker } from './application/issuance.worker';
import { IssueRewardUseCase } from './application/issue-reward.usecase';
import { RedemptionRepository } from './adapters/out/redemption.repository';
import { StoreRepository } from './adapters/out/store.repository';
import { RedeemUseCase } from './application/redeem.usecase';
import { RewardsFacade } from './application/rewards.facade';

/** The redemption repository on the owner connection, for the cross-tenant sweep. */
export const JOB_REDEMPTION_REPOSITORY = Symbol('JobRedemptionRepository');

@Module({
  imports: [IdentityModule, LedgerModule, IntegrationModule],
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
    {
      provide: IssueRewardUseCase,
      inject: [
        UnitOfWork,
        RedemptionRepository,
        IntegrationFacade,
        IdentityFacade,
        LedgerFacade,
        EVENT_BUS,
        CLOCK,
        LOGGER,
        APP_CONFIG,
      ],
      useFactory: (
        uow: UnitOfWork,
        redemptions: RedemptionRepository,
        integration: IntegrationFacade,
        identity: IdentityFacade,
        ledger: LedgerFacade,
        bus: EventBusPort,
        clock: Clock,
        logger: Logger,
        config: AppConfig,
      ) =>
        new IssueRewardUseCase(uow, redemptions, integration, identity, ledger, bus, clock, logger, {
          maxAttempts: config.issuanceMaxAttempts,
          baseBackoffMs: config.issuanceBaseBackoffMs,
          maxBackoffMs: config.issuanceMaxBackoffMs,
          claimTimeoutMs: config.issuanceClaimTimeoutMs,
          // From configuration, not from the pid: a claim that cannot name the
          // worker holding it cannot be required by a money write-back either.
          instanceId: `issuance-${config.instanceId}`,
        }),
    },
    {
      provide: IssueRedemptionConsumer,
      inject: [UnitOfWork, IssueRewardUseCase],
      useFactory: (uow: UnitOfWork, issue: IssueRewardUseCase) => new IssueRedemptionConsumer(uow, issue),
    },
    {
      // The handlers as a VALUE, so a composition root never names the adapter.
      provide: REWARDS_EVENT_HANDLERS,
      inject: [IssueRedemptionConsumer],
      useFactory: (issueRedemption: IssueRedemptionConsumer): RewardsEventHandlers => [issueRedemption],
    },
    {
      // The same repository, bound to the OWNER unit of work. The sweep's query
      // is a repository method like any other — it just runs on the connection
      // that is allowed to look across tenants.
      provide: JOB_REDEMPTION_REPOSITORY,
      inject: [JobUnitOfWork],
      useFactory: (uow: JobUnitOfWork) => new RedemptionRepository(uow),
    },
    {
      provide: IssuanceWorker,
      inject: [JobUnitOfWork, JOB_REDEMPTION_REPOSITORY, IssueRewardUseCase, CLOCK, LOGGER, APP_CONFIG],
      useFactory: (
        uow: JobUnitOfWork,
        redemptions: RedemptionRepository,
        issue: IssueRewardUseCase,
        clock: Clock,
        logger: Logger,
        config: AppConfig,
      ) => new IssuanceWorker(uow, redemptions, issue, clock, logger, config.issuanceClaimTimeoutMs),
    },
  ],
  exports: [RewardsFacade, RedeemUseCase, IssueRewardUseCase, IssuanceWorker, REWARDS_EVENT_HANDLERS],
})
export class RewardsModule {}
