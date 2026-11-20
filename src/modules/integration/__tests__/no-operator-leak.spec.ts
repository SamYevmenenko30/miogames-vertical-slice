import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * S8 is a structural claim, so it is tested structurally: grep the tree.
 * `arch-check` says modules may not import each other's internals; this says the
 * operator's NAME does not leak either, which is the thing that makes onboarding
 * operator #10 a one-adapter change.
 */
const scan = (): string[] => {
  const out = execFileSync(
    'git',
    ['grep', '-l', '-E', 'casino-(a|b)\\b', '--', 'src', 'db'],
    { encoding: 'utf8', cwd: process.cwd() },
  );
  return out.split('\n').filter(Boolean);
};

describe('integration — operator names do not leak', () => {
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
