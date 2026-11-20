import { randomUUID } from 'node:crypto';
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
  /**
   * Who this process is. It goes into every claim this worker takes, so a stuck
   * redemption names the worker — and the host — that took it. It must be unique
   * per PROCESS (`config.instanceId`); the claim below makes it unique per CLAIM.
   */
  instanceId: string;
};

/**
 * Ask the operator to issue a reward, and deal with every way that can go wrong.
 *
 * The external call is never inside a transaction: an HTTP call in a transaction
 * holds a database connection for as long as someone else's timeout. So the shape
 * is claim (transaction) → call (no transaction) → record (transaction), and the
 * claim is a conditional UPDATE so two workers cannot both start issuing the same
 * reward.
 *
 * `execute` therefore has exactly ONE caller: the issuance sweep, which invokes
 * it with nothing open. The outbox consumer calls `scheduleFirstAttempt` instead
 * and only marks the redemption due. That split was bought with a defect — when
 * the consumer called `execute` directly, `UnitOfWork`'s re-entrancy meant every
 * `withTransaction` below JOINED the consumer's transaction, so the sentence
 * above was false on every first attempt and a pooled connection was held across
 * the operator's timeout. One way in; one place that talks to an operator.
 *
 * The claim also takes a LEASE. If this process dies between the operator call
 * and recording the outcome, the sweep re-claims the redemption once the lease
 * expires and asks the operator AGAIN. That is not safe, and it used to say it
 * was: the intent below carries `redemption:<id>` as its idempotency key, but
 * honouring that key is somebody else's decision, and neither of this
 * repository's simulated operators honours it. So a recovery may grant the reward
 * a second time (TD-0011), and what this use case guarantees instead is that the
 * ambiguity is RECORDED: the claim increments `grantRequests` before the call, so
 * `grantRequests > 1` on an issued redemption is the reconciliation list. The
 * player is charged once either way.
 *
 * Every claim carries a token of its own, and the three write-backs require it.
 * A worker whose lease expired while its operator call was in flight therefore
 * finds no row to write, and logs. Without that, its outcome landed on top of
 * whatever a peer had done in the meantime — a failure written over a success,
 * with the coins refunded for a reward the operator had granted.
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

  /**
   * Make a freshly requested redemption due, so the sweep issues it.
   *
   * One short write, so it joins the consumer's transaction harmlessly — and that
   * is the point: the processed-event claim and the schedule commit together, and
   * the operator call happens later, on the sweep, with nothing open.
   */
  async scheduleFirstAttempt(redemptionId: string): Promise<void> {
    await this.uow.withTransaction(async () =>
      this.redemptions.markDueForIssuance(redemptionId, this.clock.now()),
    );
  }

  async execute(redemptionId: string): Promise<void> {
    // Unique per CLAIM, and it names the worker: `<instance>/<uuid>`. Per-process
    // would not do. A pid is not unique across containers (two worker replicas
    // were measured as pid 25), and even a unique process id would let one
    // worker's re-claim be written over by its own earlier attempt, which is
    // precisely the attempt whose write-back has to be refused.
    const claim = `${this.options.instanceId}/${randomUUID()}`;
    const claimed = await this.uow.withTransaction(async () =>
      this.redemptions.claimForIssuance(redemptionId, this.clock.now(), claim, this.options.claimTimeoutMs),
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
      const recorded = await this.uow.withTransaction(async () => {
        if (!(await this.redemptions.markIssued(claimed.id, claim, result.reference, now))) return false;
        await this.bus.publish({
          name: REWARDS_REDEMPTION_ISSUED,
          tenantId: claimed.tenantId,
          aggregateType: 'redemption',
          aggregateId: claimed.id,
          payload: { redemptionId: claimed.id, externalRef: result.reference, issuedAt: now.toISOString() },
        });
        return true;
      });
      if (!recorded) {
        // The worst-shaped lost claim: the operator granted the reward and a peer
        // has already recorded its own grant. Two grants, one charge — loudly,
        // because this one needs a human and an operator statement.
        this.logger.error(
          { redemptionId: claimed.id, claim, externalRef: result.reference, grantRequests: claimed.grantRequests },
          'the issuance claim was gone before the grant could be recorded; the operator granted this reward for a claim nobody holds — reconcile',
        );
        return;
      }
      if (claimed.grantRequests > 1) {
        // The lease did its job and the player has their reward. What nobody can
        // tell from here is whether the operator granted it once or twice, so say
        // so now rather than leaving a row that reads like a clean first attempt.
        this.logger.warn(
          { redemptionId: claimed.id, grantRequests: claimed.grantRequests, externalRef: result.reference },
          'this redemption was requested from the operator more than once — reconcile the duplicate grant',
        );
      }
      return;
    }

    const exhausted = result.outcome === 'terminal' || attempts >= this.options.maxAttempts;
    if (!exhausted) {
      const backoff = Math.min(
        this.options.maxBackoffMs,
        this.options.baseBackoffMs * 2 ** attempts + Math.floor(Math.random() * this.options.baseBackoffMs),
      );
      const recorded = await this.uow.withTransaction(async () =>
        this.redemptions.scheduleRetry(
          claimed.id,
          claim,
          attempts,
          result.reason,
          new Date(now.getTime() + backoff),
          now,
        ),
      );
      // The expensive half of the mirror case: without the claim in the predicate
      // this moved an already ISSUED redemption back to `pending_issuance`, and
      // the sweep asked the operator to grant it all over again.
      if (!recorded) return this.claimGone(claimed.id, claim, result.reason);
      this.logger.warn({ redemptionId: claimed.id, attempts, reason: result.reason }, 'reward issuance will retry');
      return;
    }

    // Out of attempts, or a failure that can never succeed. The player must not
    // pay for either: the refund is keyed on the redemption, so a worker that
    // dies mid-refund retries into the same key instead of paying twice.
    //
    // The refund and the event are INSIDE the write-back's decision, not beside
    // it. Making the UPDATE conditional and leaving these unconditional was the
    // trap: a stale holder would then write nothing and still credit the coins
    // back for a reward a peer had successfully issued.
    const recorded = await this.uow.withTransaction(async () => {
      if (!(await this.redemptions.markFailed(claimed.id, claim, attempts, result.reason, now))) return false;
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
      return true;
    });
    if (!recorded) return this.claimGone(claimed.id, claim, result.reason);
    this.logger.error(
      { redemptionId: claimed.id, attempts, reason: result.reason, refunded: claimed.price },
      'reward issuance failed, coins refunded',
    );
  }

  /**
   * This worker no longer holds the claim it is reporting on, so a peer has
   * already finished this redemption and the outcome in hand is stale.
   *
   * News, not an error: nothing is lost and nothing is wrong. It is logged with
   * the claim so that "which worker was holding this, and what did it think
   * happened?" is answerable afterwards — which is the question the `claimed_by`
   * column exists to answer. The one shape that IS an error is a lost claim whose
   * operator call succeeded; `execute` handles that one above.
   */
  private claimGone(redemptionId: string, claim: string, reason: string): void {
    this.logger.warn(
      { redemptionId, claim, reason },
      'the issuance claim was lost while the operator was answering; a peer owns this redemption now, so the outcome is not recorded',
    );
  }

  private async externalIdOf(playerId: string): Promise<string | null> {
    return this.identity.externalIdOf(playerId);
  }
}
