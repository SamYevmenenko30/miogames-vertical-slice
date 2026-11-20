import { REWARDS_REDEMPTION_REQUESTED, rewardsRedemptionRequestedSchema } from '../../../../contracts/events';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import { IdempotentConsumer, type DeliveredEvent } from '../../../../platform/events/idempotent-consumer';
import type { IssueRewardUseCase } from '../../application/issue-reward.usecase';

/**
 * Consumes `rewards.redemption.requested`, and does NOT issue the reward.
 *
 * It marks the redemption due and stops. The sweep is the only thing that calls
 * an operator, which is what keeps an HTTP call out of a database transaction:
 * this consumer runs inside one — the base class commits the processed-event
 * claim together with its effect — and `UnitOfWork` is re-entrant, so anything
 * the handler calls joins that transaction. Issuing from here held a pooled
 * connection across the operator's timeout on every first attempt.
 *
 * Note what the idempotent base class gives and does not give: it guarantees the
 * EVENT is handled once. Issuance itself is made safe by the
 * `pending_issuance → issuing` claim and its lease, because the sweep reaches the
 * same redemption without any event at all.
 *
 * The cost is latency: a first attempt waits for the next sweep tick instead of
 * happening inline.
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
    await this.issue.scheduleFirstAttempt(parsed.data.redemptionId);
  }
}
