import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// `.env` has to mean the same thing here as it does for `pnpm dev` and the scripts,
// which load it with node's --env-file-if-exists. Vitest has no such flag, so the
// config does it: without this, DATABASE_URL_TEST in a .env file was silently ignored
// and the suite went to the default server instead.
//
// try/catch, not `?.`: the optional call guards the function being absent on an older
// Node, while `loadEnvFile` THROWS when the file is missing — and missing is the normal
// case here (this repository has no committed .env, and CI has none either). Without the
// catch, every test run in a checkout without a .env fails to load this config.
try {
  process.loadEnvFile?.('.env');
} catch {
  // no .env — real environment variables and the scripts' own defaults stand
}

/**
 * Two projects, because they cost different things to run:
 *
 *  unit        — domain + application with fake ports. No I/O, runs anywhere,
 *                milliseconds. This is where the rules engine, the wheel draw
 *                and the ledger invariants are proved.
 *  integration — real Postgres, real HTTP, real adapters against the simulated
 *                casino. Needs `docker compose up -d postgres`. Each file gets
 *                its own database (see src/test/db.ts), so files cannot leak
 *                state into each other and may run in parallel.
 */
const swcPlugin = () => swc.vite({ module: { type: 'es6' } });

export default defineConfig({
  test: {
    globals: false,
    projects: [
      {
        plugins: [swcPlugin()],
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.integration.spec.ts'],
          environment: 'node',
          // The distribution tests draw 100k samples through HMAC, which is ~5s
          // on a loaded machine — right at vitest's default and therefore flaky
          // for a reason that has nothing to do with the code under test.
          testTimeout: 20_000,
        },
      },
      {
        plugins: [swcPlugin()],
        test: {
          name: 'integration',
          include: ['src/**/*.integration.spec.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 60_000,
          pool: 'forks',
        },
      },
    ],
  },
});
