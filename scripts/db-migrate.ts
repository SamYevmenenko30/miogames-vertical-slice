#!/usr/bin/env tsx
/**
 * Migrations are applied by this script, explicitly, as a deploy step —
 * never by the application at boot (docs/local-development.md says why).
 */
import { applyMigrations } from '../src/platform/db/migrator';

const url = process.env.DATABASE_URL ?? 'postgres://mio:mio@localhost:5440/mio';

applyMigrations(url)
  .then((applied) => {
    if (applied.length === 0) {
      console.log('db:migrate — nothing to apply, schema is current.');
      return;
    }
    for (const file of applied) console.log(`db:migrate — applied ${file}`);
  })
  .catch((error: unknown) => {
    console.error(`db:migrate — FAILED: ${String(error)}`);
    process.exit(1);
  });
