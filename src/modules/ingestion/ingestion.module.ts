import { Module } from '@nestjs/common';
import { UnitOfWork } from '../../platform/db/unit-of-work';
import { EVENT_BUS, type EventBusPort } from '../../platform/events/outbox';
import { IdentityModule } from '../identity/identity.module';
import { IntegrationFacade } from '../integration';
import { IntegrationModule } from '../integration/integration.module';
import { IngestController } from './adapters/in/ingest.controller';
import { DedupRepository } from './adapters/out/dedup.repository';
import { EnvelopeRepository } from './adapters/out/envelope.repository';
import { IngestDepositUseCase } from './application/ingest-deposit.usecase';
import { IngestionFacade } from './application/ingestion.facade';

@Module({
  imports: [IdentityModule, IntegrationModule],
  controllers: [IngestController],
  providers: [
    { provide: EnvelopeRepository, inject: [UnitOfWork], useFactory: (uow: UnitOfWork) => new EnvelopeRepository(uow) },
    { provide: DedupRepository, inject: [UnitOfWork], useFactory: (uow: UnitOfWork) => new DedupRepository(uow) },
    {
      provide: IngestDepositUseCase,
      inject: [UnitOfWork, IntegrationFacade, EnvelopeRepository, DedupRepository, EVENT_BUS],
      useFactory: (
        uow: UnitOfWork,
        integration: IntegrationFacade,
        envelopes: EnvelopeRepository,
        dedup: DedupRepository,
        bus: EventBusPort,
      ) => new IngestDepositUseCase(uow, integration, envelopes, dedup, bus),
    },
    {
      provide: IngestionFacade,
      inject: [IngestDepositUseCase],
      useFactory: (useCase: IngestDepositUseCase) => new IngestionFacade(useCase),
    },
  ],
  exports: [IngestionFacade],
})
export class IngestionModule {}
