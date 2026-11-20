import type { IngestDecision } from '../domain/envelope';
import type { IngestDepositUseCase } from './ingest-deposit.usecase';

export class IngestionFacade {
  constructor(private readonly ingestDeposit: IngestDepositUseCase) {}

  async ingestDepositEvent(input: {
    tenantId: string;
    operator: string;
    raw: Record<string, unknown>;
  }): Promise<IngestDecision> {
    return this.ingestDeposit.execute(input);
  }
}
