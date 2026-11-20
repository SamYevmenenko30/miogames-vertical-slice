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

/**
 * The limits that keep database work bounded (MIO-016).
 *
 * They are sent as startup parameters, so the server enforces them on every
 * statement of every connection in the pool — not as a wrapper a call site can
 * forget, and not as an application-side timer that lets the statement keep
 * running after we stopped waiting for it.
 *
 * Optional, because the migrator and the test helpers open connections for which
 * these limits would be wrong; what is NOT optional is that the application's
 * pools get them, which `platform.module.ts` does from configuration.
 */
export type DatabaseTimeouts = {
  /** A statement that runs past this is cancelled (SQLSTATE 57014). */
  statementMs: number;
  /** A lock wait that runs past this fails rather than queues (55P03). */
  lockMs: number;
  /** A transaction idle between statements past this is terminated (25P03). */
  idleInTransactionMs: number;
  /** How long the driver waits for a connection before failing, in seconds. */
  connectSeconds: number;
};

export function createDatabase(options: {
  url: string;
  max?: number;
  timeouts?: DatabaseTimeouts;
}): Database {
  const { timeouts } = options;
  const sql = postgres(options.url, {
    max: options.max ?? 10,
    onnotice: () => {},
    // A money-shaped system should not silently coerce; keep numerics as strings
    // and parse them where the type is known.
    transform: { undefined: null },
    ...(timeouts ? { connect_timeout: timeouts.connectSeconds } : {}),
    // Startup parameters. Postgres reads a bare integer for each of these as
    // milliseconds, and `pg_settings.setting` reports it back in the same unit —
    // which is what the spec asserts against, because `current_setting` formats
    // it ('15s') and a formatted value is not a thing to assert on.
    connection: timeouts
      ? {
          statement_timeout: timeouts.statementMs,
          lock_timeout: timeouts.lockMs,
          idle_in_transaction_session_timeout: timeouts.idleInTransactionMs,
        }
      : {},
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
