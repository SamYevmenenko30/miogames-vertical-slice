import type { EventHandler } from '../../../platform/events/idempotent-consumer';

/** This module's event handlers, as a value — see gamification's ports for why. */
export const REWARDS_EVENT_HANDLERS = Symbol('RewardsEventHandlers');
export type RewardsEventHandlers = EventHandler[];

import type { Redemption, RedemptionStatus, RewardPayload, StoreItem } from '../domain/redemption';

export interface StoreRepositoryPort {
  upsert(item: StoreItem): Promise<void>;
  list(): Promise<StoreItem[]>;
  find(itemId: string): Promise<StoreItem | null>;
}

export type NewRedemption = {
  id: string;
  playerId: string;
  itemId: string;
  price: number;
  reward: RewardPayload;
  idempotencyKey: string;
  at: Date;
};

export interface RedemptionRepositoryPort {
  /** Claims the idempotency key; returns the existing redemption on a replay. */
  create(input: NewRedemption): Promise<{ redemption: Redemption; claimed: boolean }>;
  findForPlayer(id: string, playerId: string): Promise<Redemption | null>;
  findById(id: string): Promise<Redemption | null>;
  /**
   * Move a redemption into `issuing`, take a LEASE on it, and record that the
   * operator is about to be asked.
   *
   * Claims a `pending_issuance` row, and also an `issuing` row whose lease has
   * gone stale — a worker that died between the operator call and recording its
   * outcome must not wedge the redemption, and the coins, for good.
   *
   * `claim` identifies this one act of claiming, not this process. The returned
   * redemption's `grantRequests` includes this claim.
   */
  claimForIssuance(id: string, now: Date, claim: string, leaseMs: number): Promise<Redemption | null>;
  /**
   * Make a freshly requested redemption due for the sweep, without issuing it.
   * Idempotent: it only touches a `pending_issuance` row that has no schedule yet,
   * so a redelivered event cannot pull a backoff forward.
   */
  markDueForIssuance(id: string, now: Date): Promise<void>;
  /**
   * Record the outcome of one claim. Each returns FALSE when the claim is no
   * longer held — the row has moved on, and a worker that comes back to find that
   * has learned something to log rather than something to overwrite. Whatever
   * else belongs to the outcome (the refund, the event) is conditional on the
   * answer, because a tighter UPDATE with an unconditional refund beside it still
   * pays the player.
   */
  markIssued(id: string, claim: string, externalRef: string, now: Date): Promise<boolean>;
  scheduleRetry(id: string, claim: string, attempts: number, error: string, nextAttemptAt: Date, now: Date): Promise<boolean>;
  markFailed(id: string, claim: string, attempts: number, error: string, now: Date): Promise<boolean>;
  statusOf(id: string): Promise<RedemptionStatus | null>;
  /**
   * Work the sweep must pick up, across every tenant: a retry that is due, or an
   * issuance whose lease has expired. Returns identifiers only.
   */
  dueForRetry(now: Date, limit: number, leaseMs: number): Promise<Array<{ id: string; tenantId: string }>>;
}
