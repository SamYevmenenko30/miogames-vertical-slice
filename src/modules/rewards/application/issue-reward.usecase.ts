import type { Clock } from '../../../platform/clock/clock';
import type { UnitOfWork } from '../../../platform/db/unit-of-work';
import type { EventBusPort } from '../../../platform/events/outbox';
import type { Logger } from '../../../platform/observability/logger';
import { REWARDS_REDEMPTION_FAILED, REWARDS_REDEMPTION_ISSUED } from '../../../contracts/events';
import type { IdentityFacade } from '../../identity';
import type { IntegrationFacade, RewardIntent } from '../../integration';
import type { LedgerFacade } from '../../ledger';
import type { RedemptionRepositoryPort } from './ports';

export type IssuanceOptions = {
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** How long this worker's `issuing` claim is honoured before a peer re-claims it. */
  claimTimeoutMs: number;
  /** Stamped on the claim, so a stuck redemption names the worker that took it. */
  instanceId: string;
};

/**
 * Ask the operator to issue a reward, and deal with every way that can go wrong.
 *
 * The external call is MEANT to sit outside a transaction — an HTTP call in a
 * transaction holds a database connection for as long as someone else's timeout —
 * and on the retry path it does. See the second caveat below for where it does
 * not, which is measured, not assumed.
 * So the shape is claim (transaction) → call (no transaction) → record
 * (transaction), and the claim is a conditional UPDATE so two workers cannot both
 * start issuing the same reward.
 *
 * Two caveats, both measured rather than assumed:
 *
 *   - The claim takes a LEASE. If this process dies between the operator call and
 *     recording the outcome, the sweep re-claims the redemption once the lease
 *     expires. Re-attempting is safe because the intent below carries
 *     `redemption:<id>` as its idempotency key, so an operator that already
 *     granted the reward returns the same reference instead of granting a second.
 *   - "call (no transaction)" holds on the RETRY path, where the sweep invokes
 *     this with nothing open. On the first attempt the outbox consumer is already
 *     inside a transaction and `UnitOfWork` is re-entrant, so the calls below
 *     JOIN it and the operator call does run with a transaction open. That is
 *     TD-0011, not a thing this comment should claim is otherwise.
 */
export class IssueRewardUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly redemptions: RedemptionRepositoryPort,
    private readonly integration: IntegrationFacade,
    private readonly identity: IdentityFacade,
    private readonly ledger: LedgerFacade,
    private readonly bus: EventBusPort,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: IssuanceOptions,
  ) {}

  async execute(redemptionId: string): Promise<void> {
    const claimed = await this.uow.withTransaction(async () =>
      this.redemptions.claimForIssuance(
        redemptionId,
        this.clock.now(),
        this.options.instanceId,
        this.options.claimTimeoutMs,
      ),
    );
    // Someone else has it, or it is already issued or failed. Not an error.
    if (!claimed) return;

    const tenant = await this.identity.findTenantById(claimed.tenantId);
    if (!tenant) throw new Error(`redemption ${redemptionId} belongs to unknown tenant ${claimed.tenantId}`);

    const player = await this.identity.findPlayerById(claimed.playerId);
    const externalPlayerId = await this.externalIdOf(claimed.playerId);
    if (!player || !externalPlayerId) {
      throw new Error(`redemption ${redemptionId} names a player this tenant cannot see`);
    }

    const intent: RewardIntent = {
      externalPlayerId,
      kind: claimed.reward.kind,
      units: claimed.reward.kind === 'free_spins' ? claimed.reward.count : claimed.reward.amountMinor,
      ...(claimed.reward.kind === 'bonus_cash' ? { currency: claimed.reward.currency } : {}),
      idempotencyKey: `redemption:${claimed.id}`,
    };

    const result = await this.integration.issueReward(tenant.operator, intent);
    const now = this.clock.now();
    const attempts = claimed.attempts + 1;

    if (result.outcome === 'issued') {
      await this.uow.withTransaction(async () => {
        await this.redemptions.markIssued(claimed.id, result.reference, now);
        await this.bus.publish({
          name: REWARDS_REDEMPTION_ISSUED,
          tenantId: claimed.tenantId,
          aggregateType: 'redemption',
          aggregateId: claimed.id,
          payload: { redemptionId: claimed.id, externalRef: result.reference, issuedAt: now.toISOString() },
        });
      });
      return;
    }

    const exhausted = result.outcome === 'terminal' || attempts >= this.options.maxAttempts;
    if (!exhausted) {
      const backoff = Math.min(
        this.options.maxBackoffMs,
        this.options.baseBackoffMs * 2 ** attempts + Math.floor(Math.random() * this.options.baseBackoffMs),
      );
      await this.uow.withTransaction(async () =>
        this.redemptions.scheduleRetry(
          claimed.id,
          attempts,
          result.reason,
          new Date(now.getTime() + backoff),
          now,
        ),
      );
      this.logger.warn({ redemptionId: claimed.id, attempts, reason: result.reason }, 'reward issuance will retry');
      return;
    }

    // Out of attempts, or a failure that can never succeed. The player must not
    // pay for either: the refund is keyed on the redemption, so a worker that
    // dies mid-refund retries into the same key instead of paying twice.
    await this.uow.withTransaction(async () => {
      await this.redemptions.markFailed(claimed.id, attempts, result.reason, now);
      await this.ledger.credit({
        playerId: claimed.playerId,
        coins: claimed.price,
        reason: `redemption.refund:${claimed.itemId}`,
        idempotencyKey: `redemption:${claimed.id}:refund`,
      });
      await this.bus.publish({
        name: REWARDS_REDEMPTION_FAILED,
        tenantId: claimed.tenantId,
        aggregateType: 'redemption',
        aggregateId: claimed.id,
        payload: {
          redemptionId: claimed.id,
          attempts,
          reason: result.reason,
          refundedCoins: claimed.price,
          failedAt: now.toISOString(),
        },
      });
    });
    this.logger.error(
      { redemptionId: claimed.id, attempts, reason: result.reason, refunded: claimed.price },
      'reward issuance failed, coins refunded',
    );
  }

  private async externalIdOf(playerId: string): Promise<string | null> {
    return this.identity.externalIdOf(playerId);
  }
}
