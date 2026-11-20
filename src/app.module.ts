import { Module } from '@nestjs/common';
import { IdentityModule } from './modules/identity/identity.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PlatformModule } from './platform/platform.module';

/** The HTTP composition: platform, then the business modules that expose routes. */
@Module({
  imports: [PlatformModule, IdentityModule, IntegrationModule, IngestionModule, LedgerModule, GamificationModule],
})
export class AppModule {}
