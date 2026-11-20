import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { Database, Tx } from './database';
import { currentTenantIdOrNull } from './tenant-context';

type Scope = { tx: Tx };

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
  /**
   * Per INSTANCE, not module-global. There are two units of work in the worker —
   * one on the application role, one on the owner for the single cross-tenant
   * sweep — and a shared store would let the owner's transaction join the
   * application's, which is the worst possible way to lose an isolation
   * guarantee.
   */
  private readonly store = new AsyncLocalStorage<Scope>();

  constructor(private readonly database: Database) {}

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.store.getStore()) return fn();
    return this.database.db.transaction(async (tx) => {
      // The tenant reaches the database here, as a TRANSACTION-local setting.
      // `SET LOCAL`, not `SET`: a pooled connection must not carry one request's
      // tenant into the next (ADR-0006, and MIO-011 S5 proves it).
      const tenantId = currentTenantIdOrNull();
      if (tenantId !== null) {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      }
      return this.store.run({ tx }, fn);
    });
  }

  /**
   * The transactional client. Throws outside a unit of work rather than falling
   * back to an auto-commit connection — a write that silently escapes its
   * transaction is worse than a crash.
   */
  get tx(): Tx {
    const scope = this.store.getStore();
    if (!scope) {
      throw new Error(
        'No unit of work is open. Wrap this in uow.withTransaction(...) — a write outside a transaction cannot be rolled back.',
      );
    }
    return scope.tx;
  }

  inTransaction(): boolean {
    return this.store.getStore() !== undefined;
  }
}

/**
 * The same unit of work, on the OWNER connection.
 *
 * A distinct class only so Nest can tell them apart, and so a call site has to
 * say which one it means. Use it for nothing but work that is legitimately
 * cross-tenant and reads only identifiers — today that is the issuance retry
 * sweep, named in MIO-011 Q1 so a second such path has to argue for itself.
 */
export class JobUnitOfWork extends UnitOfWork {}
