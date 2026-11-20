import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * S8 is a structural claim, so it is tested structurally: grep the tree.
 * `arch-check` says modules may not import each other's internals; this says the
 * operator's NAME does not leak either, which is the thing that makes onboarding
 * operator #10 a one-adapter change.
 */
const scan = (): string[] => {
  // `--untracked`, because during the implementation phase the files that would
  // leak are not committed yet — without it this test measures the index and
  // passes vacuously exactly when it matters. And exit code 1 means "no matches",
  // which is a result, not a failure.
  try {
    const out = execFileSync(
      'git',
      // No `\b`: git grep's -E engine does not implement it, and the pattern then
      // matches nothing at all — which is how BOTH assertions below passed while
      // proving nothing. The presence assertion is what caught that.
      // `casino-[a-z0-9-]+`, not `casino-(a|b)`: a guard keyed to the operators
      // that exist today says nothing about the next one. A rehearsal that
      // onboarded operator C found this test green while C's name was free to
      // leak anywhere — the third time this repository has written a check
      // against its instances rather than against its rule (round one found it
      // in the RLS policy census, round two in arch-check's event census).
      ['grep', '-l', '--untracked', '-E', 'casino-[a-z0-9-]+', '--', 'src', 'db'],
      { encoding: 'utf8', cwd: process.cwd() },
    );
    return out.split('\n').filter(Boolean);
  } catch (error) {
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
};

describe('integration — operator names do not leak', () => {
  it('S8 — the invariant has a subject: the integration module does name both operators', () => {
    // Without this, the whole file is vacuous whenever nothing names an operator
    // at all — which is also how it looked at the merge-base, and red-check said
    // so by refusing a green verdict.
    const owners = scan().filter((file) => file.startsWith('src/modules/integration/'));
    expect(owners.length).toBeGreaterThan(0);
  });

  it('S8 — only the integration module, the mocks and tests name an operator', () => {
    const offenders = scan().filter(
      (file) =>
        !file.startsWith('src/modules/integration/') &&
        !file.startsWith('src/mocks/') &&
        !file.startsWith('src/test/') &&
        !/\.spec\.ts$/.test(file),
    );
    expect(offenders).toEqual([]);
  });

  it('S8 — and the gamification, ledger, rewards and ingestion modules never do', () => {
    const forbidden = scan().filter((file) =>
      /^src\/modules\/(gamification|ledger|rewards|ingestion)\//.test(file) && !/\.spec\.ts$/.test(file),
    );
    expect(forbidden).toEqual([]);
  });
});
