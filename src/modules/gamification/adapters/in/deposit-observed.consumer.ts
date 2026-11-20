import { CASINO_DEPOSIT_OBSERVED, casinoDepositObservedSchema } from '../../../../contracts/events';
import { IdempotentConsumer, type DeliveredEvent } from '../../../../platform/events/idempotent-consumer';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import type { GrantEntitlementsUseCase } from '../../application/grant-entitlements.usecase';

/**
 * The only consumer of `casino.deposit.observed`.
 *
 * Its claim on the event and the grant it performs share one transaction (see
 * IdempotentConsumer), so a redelivery grants nothing extra and a failure grants
 * nothing at all.
 */
export class DepositObservedConsumer extends IdempotentConsumer {
  readonly name = 'gamification.grant-entitlements';
  readonly eventName = CASINO_DEPOSIT_OBSERVED;

  constructor(
    unitOfWork: UnitOfWork,
    private readonly grant: GrantEntitlementsUseCase,
  ) {
    super(unitOfWork);
  }

  protected async handle(event: DeliveredEvent): Promise<void> {
    const parsed = casinoDepositObservedSchema.safeParse(event.payload);
    if (!parsed.success) {
      // Ingestion validated this before publishing, so a failure here means the
      // contract changed under us — loud, not swallowed.
      throw new Error(`casino.deposit.observed payload does not match its schema: ${parsed.error.message}`);
    }
    // Already inside the event's tenant scope: the base class entered it before
    // the transaction, which is what lets the unit of work tell the database.
    await this.grant.execute({
      externalPlayerId: parsed.data.externalPlayerId,
      amount: parsed.data.amount,
      sourceEventId: event.id,
    });
  }
}
