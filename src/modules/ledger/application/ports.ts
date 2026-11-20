import type { Coins, LedgerDirection, LedgerEntry, Movement } from '../domain/entry';

export interface LedgerRepositoryPort {
  /** Claims the idempotency key. Returns the existing entry when it was already used. */
  recordEntry(
    direction: LedgerDirection,
    movement: Movement,
    at: Date,
  ): Promise<{ entry: LedgerEntry; claimed: boolean }>;
  /** Locks the balance row for this transaction, creating it at zero if absent. */
  lockBalance(playerId: string): Promise<Coins>;
  applyDelta(playerId: string, delta: number): Promise<Coins>;
  balanceOf(playerId: string): Promise<Coins>;
  history(playerId: string, limit: number): Promise<LedgerEntry[]>;
}
