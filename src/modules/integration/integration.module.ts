import { Module } from '@nestjs/common';
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
    { provide: CASINO_REWARD_ADAPTERS, useValue: [] as CasinoRewardPort[] },
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
