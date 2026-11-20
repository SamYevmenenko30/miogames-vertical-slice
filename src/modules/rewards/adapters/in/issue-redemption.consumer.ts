import { REWARDS_REDEMPTION_REQUESTED, rewardsRedemptionRequestedSchema } from '../../../../contracts/events';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import { IdempotentConsumer, type DeliveredEvent } from '../../../../platform/events/idempotent-consumer';
import type { IssueRewardUseCase } from '../../application/issue-reward.usecase';

/**
 * Consumes `rewards.redemption.requested`.
 *
 * Note what the idempotent base class gives and does not give here: it guarantees
 * the EVENT is handled once. The issuance itself is made safe by the
 * `pending_issuance → issuing` claim inside the use case, because a retry sweep
 * reaches the same redemption without any event at all.
 */
export class IssueRedemptionConsumer extends IdempotentConsumer {
  readonly name = 'rewards.issue-redemption';
  readonly eventName = REWARDS_REDEMPTION_REQUESTED;

  constructor(
    unitOfWork: UnitOfWork,
    private readonly issue: IssueRewardUseCase,
  ) {
    super(unitOfWork);
  }

  protected async handle(event: DeliveredEvent): Promise<void> {
    const parsed = rewardsRedemptionRequestedSchema.safeParse(event.payload);
    if (!parsed.success) {
      throw new Error(`rewards.redemption.requested payload does not match its schema: ${parsed.error.message}`);
    }
    // Already inside the event's tenant scope (the base class entered it).
    await this.issue.execute(parsed.data.redemptionId);
  }
}
