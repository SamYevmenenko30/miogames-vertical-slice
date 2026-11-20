import { Module } from '@nestjs/common';
import { AdminAuditController, OPERATOR_AUTHENTICATOR } from './platform/audit/admin-audit.controller';
import { HealthController } from './platform/observability/health.controller';
import { IdentityFacade } from './modules/identity';
import { IdentityModule } from './modules/identity/identity.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { RewardsModule } from './modules/rewards/rewards.module';
import { PlatformModule } from './platform/platform.module';

/** The HTTP composition: platform, then the business modules that expose routes. */
@Module({
  imports: [PlatformModule, IdentityModule, IntegrationModule, IngestionModule, LedgerModule, GamificationModule, RewardsModule],
  controllers: [HealthController, AdminAuditController],
  providers: [
    {
      // The audit reader authenticates through a PORT, because platform may not
      // import a business module. The composition root is where the two meet.
      provide: OPERATOR_AUTHENTICATOR,
      inject: [IdentityFacade],
      useFactory: (identity: IdentityFacade) => ({
        authenticate: async (keyId: string, secret: string) => {
          const operator = await identity.authenticate(keyId, secret);
          return operator ? { tenantId: operator.tenantId, keyId: operator.keyId } : null;
        },
      }),
    },
  ],
})
export class AppModule {}
