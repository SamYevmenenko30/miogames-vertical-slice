import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../platform/clock/clock';
import { UnitOfWork } from '../../platform/db/unit-of-work';
import { LedgerRepository } from './adapters/out/ledger.repository';
import { LedgerFacade } from './application/ledger.facade';

@Module({
  providers: [
    { provide: LedgerRepository, inject: [UnitOfWork], useFactory: (uow: UnitOfWork) => new LedgerRepository(uow) },
    {
      provide: LedgerFacade,
      inject: [UnitOfWork, LedgerRepository, CLOCK],
      useFactory: (uow: UnitOfWork, repository: LedgerRepository, clock: Clock) =>
        new LedgerFacade(uow, repository, clock),
    },
  ],
  exports: [LedgerFacade],
})
export class LedgerModule {}
