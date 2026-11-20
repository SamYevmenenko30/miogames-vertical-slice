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
   * Move a redemption into `issuing` and take a LEASE on it.
   *
   * Claims a `pending_issuance` row, and also an `issuing` row whose lease has
   * gone stale — a worker that died between the operator call and recording its
   * outcome must not wedge the redemption, and the coins, for good.
   */
  claimForIssuance(id: string, now: Date, claimedBy: string, leaseMs: number): Promise<Redemption | null>;
  markIssued(id: string, externalRef: string, now: Date): Promise<void>;
  scheduleRetry(id: string, attempts: number, error: string, nextAttemptAt: Date, now: Date): Promise<void>;
  markFailed(id: string, attempts: number, error: string, now: Date): Promise<void>;
  statusOf(id: string): Promise<RedemptionStatus | null>;
  /**
   * Work the sweep must pick up, across every tenant: a retry that is due, or an
   * issuance whose lease has expired. Returns identifiers only.
   */
  dueForRetry(now: Date, limit: number, leaseMs: number): Promise<Array<{ id: string; tenantId: string }>>;
}
