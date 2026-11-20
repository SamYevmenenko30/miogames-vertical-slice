import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config';
import { CasinoARewardAdapter } from './adapters/out/casino-a-reward.adapter';
import { CasinoBRewardAdapter } from './adapters/out/casino-b-reward.adapter';
import { CasinoADialect } from './adapters/in/casino-a.dialect';
import { CasinoBDialect } from './adapters/in/casino-b.dialect';
import { DialectRegistry } from './application/dialect-registry';
import { IntegrationFacade } from './application/integration.facade';
import { CASINO_REWARD_ADAPTERS, type CasinoRewardPort } from './application/ports';

/**
 * Onboarding operator #3 is one adapter and one line here. Nothing in
 * gamification, ledger, rewards or ingestion changes — that is the whole claim of
 * ADR-0002, and `no-operator-leak.spec.ts` keeps it true.
 */
@Module({
  providers: [
    { provide: DialectRegistry, useFactory: () => new DialectRegistry([new CasinoADialect(), new CasinoBDialect()]) },
    {
      // Onboarding operator #3 adds one line here.
      provide: CASINO_REWARD_ADAPTERS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): CasinoRewardPort[] => [
        new CasinoARewardAdapter(config),
        new CasinoBRewardAdapter(config),
      ],
    },
    {
      provide: IntegrationFacade,
      inject: [DialectRegistry, CASINO_REWARD_ADAPTERS],
      useFactory: (dialects: DialectRegistry, rewards: CasinoRewardPort[]) =>
        new IntegrationFacade(dialects, rewards),
    },
  ],
  exports: [IntegrationFacade],
})
export class IntegrationModule {}
