import { Module } from '@nestjs/common';
import { GamificationModule } from './modules/gamification/gamification.module';
import { IdentityModule } from './modules/identity/identity.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { RewardsModule } from './modules/rewards/rewards.module';
import { PlatformModule } from './platform/platform.module';

/** The worker's composition: the same modules, none of their controllers. */
@Module({
  imports: [PlatformModule, IdentityModule, IntegrationModule, LedgerModule, GamificationModule, RewardsModule],
})
export class WorkerModule {}
