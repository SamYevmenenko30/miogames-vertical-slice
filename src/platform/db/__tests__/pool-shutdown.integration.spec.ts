import { expect, it } from 'vitest';
import { DATABASE, OWNER_DATABASE, type Database } from '../database';
import { startTestApi } from '../../../test/api.helper';

/**
 * MIO-015 S12 — the application lets go of its connections when it shuts down.
 *
 * `DATABASE` and `OWNER_DATABASE` are factory providers returning a plain object
 * with a `close()` method, and Nest does not call lifecycle methods on a plain
 * object — so nothing ever called it. Two measured consequences (review S1, S2):
 * `pnpm db:seed`, step 5 of the documented first run, committed its work and then
 * never returned; and every worker container took Docker's full ten-second grace
 * period and died with exit code 137 — the SIGKILL that leaves a redemption
 * wedged mid-issuance in the first place.
 *
 * Asserted on the pools themselves rather than on a process's exit code: the exit
 * code is what a reader cares about, the released socket is what causes it, and
 * only one of the two is observable from inside a test runner.
 */
it('S12 — shutting the application down closes both database pools', async () => {
  const api = await startTestApi('pool-shutdown');
  const appPool = api.app.get<Database>(DATABASE);
  const ownerPool = api.app.get<Database>(OWNER_DATABASE);

  // Both are live first, so a rejection afterwards is the shutdown and not a
  // connection string that never worked.
  expect((await appPool.sql`select 1 as one`)[0]!.one).toBe(1);
  expect((await ownerPool.sql`select 1 as one`)[0]!.one).toBe(1);

  await api.app.close();

  try {
    await expect(appPool.sql`select 1`).rejects.toThrow();
    await expect(ownerPool.sql`select 1`).rejects.toThrow();
  } finally {
    // Not `api.close()`: that would close the app a second time, and this test's
    // whole subject is what closing the app does.
    await api.db.drop();
  }
});
