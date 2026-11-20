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
