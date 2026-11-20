import type { Clock } from '../../../platform/clock/clock';
import type { UnitOfWork } from '../../../platform/db/unit-of-work';
import { withTenant } from '../../../platform/db/tenant-context';
import type { Logger } from '../../../platform/observability/logger';
import type { RedemptionRepositoryPort } from './ports';
import type { IssueRewardUseCase } from './issue-reward.usecase';

/**
 * The retry sweep.
 *
 * The outbox delivers the first attempt; every attempt after it is due by
 * schedule, not by a new event, so there has to be something that looks for due
 * work. It also recovers an issuance whose LEASE has expired — the worker that
 * claimed it is presumed dead — which is the only thing standing between a
 * process crash and a redemption wedged in `issuing` with the coins gone. It runs outside any tenant scope and enters each row's tenant, because a
 * sweep is the one legitimate cross-tenant read in the system — and it reads
 * nothing but ids.
 */
export class IssuanceWorker {
  constructor(
    /** The OWNER unit of work: this is the one cross-tenant read in the system. */
    private readonly uow: UnitOfWork,
    private readonly redemptions: RedemptionRepositoryPort,
    private readonly issue: IssueRewardUseCase,
    private readonly clock: Clock,
    private readonly logger: Logger,
    /** How long another worker's `issuing` claim is honoured before we re-claim it. */
    private readonly claimTimeoutMs = 60_000,
    private readonly batchSize = 25,
  ) {}

  async runDueRetries(): Promise<number> {
    const now = this.clock.now();
    const due = await this.uow.withTransaction(async () =>
      this.redemptions.dueForRetry(now, this.batchSize, this.claimTimeoutMs),
    );
    let handled = 0;
    for (const row of due) {
      try {
        await withTenant(row.tenantId, async () => this.issue.execute(row.id));
        handled += 1;
      } catch (error) {
        this.logger.error({ redemptionId: row.id, err: String(error) }, 'issuance retry threw');
      }
    }
    return handled;
  }
}
