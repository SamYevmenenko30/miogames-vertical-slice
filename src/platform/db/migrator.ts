import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

export const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

/**
 * Migrations are applied explicitly — never at application boot, where two
 * replicas starting together race through the same file. The deploy runs this as
 * its own step; the application only checks that the schema it needs is there.
 *
 * Each file runs in its own transaction together with the row that records it, so
 * a failure leaves neither the change nor the claim that it was applied.
 */
export async function applyMigrations(url: string, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  // No statement, lock or idle-in-transaction limit here, deliberately: an index
  // build on a large table is supposed to take minutes, and a cancelled migration
  // is worse than a slow one. The application's pools carry those limits instead
  // (MIO-016 S5 pins this, because "exempt on purpose" and "forgotten" look the
  // same in a diff).
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const applied: string[] = [];
  try {
    await sql.unsafe(`
      create schema if not exists infra;
      create table if not exists infra.schema_migrations (
        version     text primary key,
        applied_at  timestamptz not null default now()
      );
    `);

    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const done = new Set(
      (await sql`select version from infra.schema_migrations`).map((row) => row.version as string),
    );

    for (const file of files) {
      if (done.has(file)) continue;
      const body = readFileSync(join(dir, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into infra.schema_migrations (version) values (${file})`;
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
