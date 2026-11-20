import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { applyMigrations } from '../../src/platform/db/migrator';

/**
 * A database of this run's own, migrated and dropped at the end.
 *
 * A smoke run that mutated the development database would be a smoke run people
 * stop running (MIO-013 Q2).
 */
export async function createSmokeDatabase(): Promise<{ ownerUrl: string; appUrl: string; drop: () => Promise<void> }> {
  const base = new URL(process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL ?? 'postgres://mio:mio@localhost:5440/mio');
  const name = `mio_smoke_${randomUUID().slice(0, 8)}`;

  const admin = postgres(base.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const ownerUrl = new URL(base.toString());
  ownerUrl.pathname = `/${name}`;
  await applyMigrations(ownerUrl.toString());

  const appUrl = new URL(ownerUrl.toString());
  appUrl.username = 'mio_app';
  appUrl.password = 'mio_app';

  return {
    ownerUrl: ownerUrl.toString(),
    appUrl: appUrl.toString(),
    drop: async () => {
      const a = postgres(base.toString(), { max: 1, onnotice: () => {} });
      try {
        await a.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await a.end({ timeout: 5 });
      }
    },
  };
}
