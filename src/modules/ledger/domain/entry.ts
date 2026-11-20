export type Coins = number;

export type LedgerDirection = 'credit' | 'debit';

export type LedgerEntry = {
  id: number;
  tenantId: string;
  playerId: string;
  direction: LedgerDirection;
  coins: Coins;
  reason: string;
  idempotencyKey: string;
  createdAt: Date;
};

export type Movement = {
  playerId: string;
  coins: Coins;
  reason: string;
  /** Derived from the cause. See ADR-0005. */
  idempotencyKey: string;
};

export function assertMovableAmount(coins: number): void {
  if (!Number.isInteger(coins) || coins <= 0) {
    throw new Error(`coins must be a positive integer, got ${coins}`);
  }
}
