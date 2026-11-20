import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

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
