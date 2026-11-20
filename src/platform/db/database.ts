// Type-only, so this file stays framework-free at runtime: `implements` is erased.
import type { OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type Db = PostgresJsDatabase<Record<string, never>>;
/** The transactional client a unit of work hands out. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type Database = {
  /** Drizzle, for typed queries. */
  readonly db: Db;
  /** The raw driver, for the handful of statements Drizzle should not express
   *  (claiming an outbox batch with FOR UPDATE SKIP LOCKED, and migrations). */
  readonly sql: postgres.Sql;
  close(): Promise<void>;
};

export const DATABASE = Symbol('Database');
/** The owner connection: migrations and the single cross-tenant job. */
export const OWNER_DATABASE = Symbol('OwnerDatabase');

export function createDatabase(options: { url: string; max?: number }): Database {
  const sql = postgres(options.url, {
    max: options.max ?? 10,
    onnotice: () => {},
    // A money-shaped system should not silently coerce; keep numerics as strings
    // and parse them where the type is known.
    transform: { undefined: null },
  });
  const db = drizzle(sql);
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}

/**
 * The pools, closed when the application shuts down.
 *
 * `DATABASE` and `OWNER_DATABASE` are factory providers returning a plain object
 * with a `close()` method, and Nest calls lifecycle hooks on the INSTANCES it
 * holds — a plain object with no hook on it has nothing to call, so nothing ever
 * closed them. Two measured consequences: `pnpm db:seed` committed its work and
 * then hung (the event loop never drained), and every `docker stop worker` took
 * Docker's full ten-second grace period and ended in exit 137 — a SIGKILL,
 * which is exactly the crash that leaves a redemption mid-issuance.
 *
 * So it is a PROVIDER, which is the thing Nest has a hook on, holding the pools
 * it must close. `close()` stays on `Database` because a script that builds a
 * pool without Nest still has to let go of it.
 */
export class DatabasePools implements OnApplicationShutdown {
  constructor(private readonly pools: readonly Database[]) {}

  async onApplicationShutdown(): Promise<void> {
    // `allSettled`: one pool failing to drain must not strand the other open, and
    // at this point there is nobody left to report the failure to anyway.
    await Promise.allSettled(this.pools.map(async (pool) => pool.close()));
  }
}
