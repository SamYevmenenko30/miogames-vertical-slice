import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database, Tx } from './database';

type Scope = { tx: Tx };

const store = new AsyncLocalStorage<Scope>();

/**
 * One transaction per use-case, opened in the application layer.
 *
 * Re-entrant on purpose: a nested `withTransaction` JOINS the outer one instead
 * of opening a second. Without that, "one transaction per use-case" stops being
 * true the first time a facade calls a facade — and the two halves of a money
 * movement end up in different transactions, which is the bug class this whole
 * design exists to prevent.
 */
export class UnitOfWork {
  constructor(private readonly database: Database) {}

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (store.getStore()) return fn();
    return this.database.db.transaction(async (tx) => store.run({ tx }, fn));
  }

  /**
   * The transactional client. Throws outside a unit of work rather than falling
   * back to an auto-commit connection — a write that silently escapes its
   * transaction is worse than a crash.
   */
  get tx(): Tx {
    const scope = store.getStore();
    if (!scope) {
      throw new Error(
        'No unit of work is open. Wrap this in uow.withTransaction(...) — a write outside a transaction cannot be rolled back.',
      );
    }
    return scope.tx;
  }

  inTransaction(): boolean {
    return store.getStore() !== undefined;
  }
}
