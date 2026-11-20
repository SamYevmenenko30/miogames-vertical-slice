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
  claimForIssuance(id: string, now: Date): Promise<Redemption | null>;
  markIssued(id: string, externalRef: string, now: Date): Promise<void>;
  scheduleRetry(id: string, attempts: number, error: string, nextAttemptAt: Date, now: Date): Promise<void>;
  markFailed(id: string, attempts: number, error: string, now: Date): Promise<void>;
  statusOf(id: string): Promise<RedemptionStatus | null>;
}
