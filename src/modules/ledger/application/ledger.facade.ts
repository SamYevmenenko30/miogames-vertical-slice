import type { Clock } from '../../../platform/clock/clock';
import type { UnitOfWork } from '../../../platform/db/unit-of-work';
import { UnprocessableError } from '../../../platform/http/errors';
import { assertMovableAmount, type Coins, type LedgerEntry, type Movement } from '../domain/entry';
import type { LedgerRepositoryPort } from './ports';

/**
 * A leaf module: called by everything that moves coins, calling nobody. That is
 * what makes its invariants provable.
 */
export class LedgerFacade {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repository: LedgerRepositoryPort,
    private readonly clock: Clock,
  ) {}

  async credit(movement: Movement): Promise<LedgerEntry> {
    assertMovableAmount(movement.coins);
    return this.uow.withTransaction(async () => {
      const { entry, claimed } = await this.repository.recordEntry('credit', movement, this.clock.now());
      if (!claimed) return entry;
      await this.repository.lockBalance(movement.playerId);
      await this.repository.applyDelta(movement.playerId, movement.coins);
      return entry;
    });
  }

  async debit(movement: Movement): Promise<LedgerEntry> {
    assertMovableAmount(movement.coins);
    return this.uow.withTransaction(async () => {
      const { entry, claimed } = await this.repository.recordEntry('debit', movement, this.clock.now());
      if (!claimed) return entry;

      // The lock is what serialises two concurrent debits; the balance read is
      // only here so the caller gets a 422 instead of a constraint violation.
      // The CHECK on the balance row is the actual invariant (ADR-0005), and it
      // would still abort this transaction if this check were wrong or missing.
      const balance = await this.repository.lockBalance(movement.playerId);
      if (balance < movement.coins) {
        throw new UnprocessableError(
          'ledger.insufficient-balance',
          `Insufficient balance: ${balance} coins available, ${movement.coins} requested.`,
          { balance, requested: movement.coins },
        );
      }
      await this.repository.applyDelta(movement.playerId, -movement.coins);
      return entry;
    });
  }

  async balanceOf(playerId: string): Promise<Coins> {
    return this.uow.withTransaction(async () => this.repository.balanceOf(playerId));
  }

  async history(playerId: string, limit = 50): Promise<LedgerEntry[]> {
    return this.uow.withTransaction(async () => this.repository.history(playerId, limit));
  }
}
