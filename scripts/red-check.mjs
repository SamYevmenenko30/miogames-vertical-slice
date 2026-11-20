#!/usr/bin/env node
/**
 * red-check — every test file this branch ADDS must FAIL at the merge-base,
 * each one on its own, in a clean worktree.
 *
 * Why this gate is the centre of the pipeline: a test written after the code,
 * or written by the same session that planned the code, has a strong tendency
 * to assert what the implementation happens to do. Such a test is green before
 * the implementation exists too — it guards nothing, and it reads exactly like
 * a real test. Coverage cannot tell the difference. A human reviewer usually
 * cannot either. Running the test without the code can.
 *
 * Method
 *   1. `git worktree add --detach` at the merge-base, with node_modules
 *      symlinked from the current tree (the base-ness we assert is about the
 *      source under test, not about the dependency tree).
 *   2. For EACH added test file: reset the worktree hard, then stage only that
 *      file (plus branch-added fixtures living beside it), and run vitest on it
 *      alone.
 *      - one file per run, because a shared run lets one red file hide a green
 *        sibling behind an aggregate exit code;
 *      - one reset per run, because whatever an earlier run left behind can
 *        manufacture the verdict of the next one.
 *   3. Classify the result:
 *      assertion-red  the test ran and its expectation failed. The strong result.
 *      crash-red      the file could not import code the branch adds. Counts as
 *                     red — it cannot pass without the branch — but proves less,
 *                     and is reported separately so a reviewer can see how much
 *                     of the suite rests on it.
 *      GREEN          the gate fails. The test does not need the branch.
 *      cannot verify  the runner could not execute the file, or the environment
 *                     (Postgres) was not there. FAILS CLOSED — never counted as
 *                     red, because "it was red" would be a claim about the
 *                     environment and not about the test.
 *
 * Honest limits
 *   - A crash-red proves "cannot pass without the branch", not "asserts the
 *     right thing". Prefer tests that fail on an assertion.
 *   - node_modules is borrowed, so a test that writes through it reaches the
 *     current tree. Running the branch's test code IS the measurement; what the
 *     reset buys is that every channel not requiring that is closed.
 *   - A green verdict can be excused only by a declaration in a commit message
 *     on this branch, naming the exact path and a reason a reviewer can check:
 *
 *       red-check-exempt: <path> — <why the base run cannot see the change>
 */
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, git, mergeBase, sh, trySh } from './lib/util.mjs';

// Unique per process: a git worktree is registered under its BASENAME in the shared
// .git/worktrees, so a fixed name collides when this gate runs inside another
// worktree of the same repository — which is exactly what gate-probes does.
const WT = join(ROOT, '.tmp', `red-check-wt-${process.pid}`);
const requireTests = process.argv.includes('--require-tests');
const base = mergeBase();

const added = git('diff', '--name-status', '--diff-filter=A', `${base}..HEAD`)
  .split('\n').filter(Boolean)
  .map((l) => l.split('\t')[1])
  .filter((p) => /\.spec\.ts$/.test(p ?? ''));

const addedAll = git('diff', '--name-only', '--diff-filter=A', `${base}..HEAD`).split('\n').filter(Boolean);

const exemptions = [];
for (const message of git('log', `${base}..HEAD`, '--pretty=%B%x01').split('\u0001')) {
  for (const m of message.matchAll(/^red-check-exempt:\s*(\S+)\s*(?:—|--)\s*(.+)$/gm)) {
    exemptions.push({ path: m[1], reason: m[2].trim() });
  }
}

console.log(`\nred-check — base ${base.slice(0, 8)}, ${added.length} added test file(s)\n`);
if (!added.length) {
  if (requireTests) {
    console.log('✗  this branch adds no test file, and --require-tests was given.');
    console.log('\nred-check: FAIL — the tests phase must add at least one failing test.');
    process.exit(1);
  }
  console.log('   nothing to check (no test file added on this branch).\n\nred-check: PASS');
  process.exit(0);
}

// --- the worktree -----------------------------------------------------------
rmSync(WT, { recursive: true, force: true });
trySh('git', ['worktree', 'prune']);
mkdirSync(dirname(WT), { recursive: true });
sh('git', ['worktree', 'add', '--detach', WT, base], { stdio: 'ignore' });
if (!existsSync(join(WT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(WT, 'node_modules'));

const vitestBin = join(WT, 'node_modules', '.bin', 'vitest');
if (!existsSync(vitestBin)) {
  console.log('✗  no vitest binary reachable from the base worktree — cannot verify anything.');
  process.exit(1);
}

function resetWorktree() {
  sh('git', ['-C', WT, 'checkout', '-f', '--detach', base], { stdio: 'ignore' });
  sh('git', ['-C', WT, 'clean', '-fdx', '-e', 'node_modules'], { stdio: 'ignore' });
}

/**
 * Files the branch added that a single spec legitimately needs: fixtures and
 * helpers beside it. NEVER another spec file — a sibling spec staged into the
 * base worktree can manufacture the verdict of the file being measured, which
 * is the one thing this gate must not allow. (It did, until a run printed
 * "staged beside it: …integration.spec.ts" and gave the game away.)
 */
function supportFor(spec) {
  const dir = dirname(spec);
  return addedAll.filter((p) =>
    p !== spec &&
    !/\.spec\.ts$/.test(p) &&
    p.startsWith(`${dir}/`) &&
    /(__fixtures__|__tests__|test-support|\.fixture\.ts|\.helper\.ts)/.test(p));
}

function stage(path) {
  const dest = join(WT, path);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, sh('git', ['show', `HEAD:${path}`]));
}

function classify(status, out) {
  // Narrow on purpose. "relation ... does not exist" means the BRANCH adds that
  // table, which is crash-red and a legitimate verdict; only a missing server,
  // database or credential is an environment problem. The first version of this
  // pattern matched both and failed a correct ticket closed.
  const env =
    /ECONNREFUSED|ENOTFOUND|getaddrinfo|password authentication failed|Connection terminated|database "[^"]+" does not exist|role "[^"]+" does not exist/i;
  const noTests = /No test files found|No test suite found|includes no tests/i;
  const assertion = /AssertionError|expected .* to |toBe|toEqual|toThrow|Snapshot .* mismatched|assert/i;
  const crash =
    /Cannot find module|Failed to resolve import|SyntaxError|is not a function|is not defined|TypeError|ReferenceError|relation "[^"]+" does not exist|schema "[^"]+" does not exist|column "[^"]+" does not exist/i;
  if (status === 0) return { verdict: 'GREEN' };
  if (noTests.test(out)) return { verdict: 'cannot verify', why: 'vitest found no test in the file' };
  if (env.test(out)) return { verdict: 'cannot verify', why: 'the environment was missing (Postgres?) — start it and re-run' };
  // Unambiguous signals first. A missing module, schema, table or column means
  // the file could not reach its assertions at all — and vitest prints the code
  // frame of the failing test, so the assertion pattern below matches `toBe(…)`
  // from the SOURCE and would otherwise claim a stronger verdict than the run
  // earned. (That is exactly what it did until a probe asserted the classifier.)
  const hardCrash =
    /Cannot find module|Failed to resolve import|relation "[^"]+" does not exist|schema "[^"]+" does not exist|column "[^"]+" does not exist/i;
  if (hardCrash.test(out)) return { verdict: 'crash-red', why: out.match(hardCrash)?.[0] };
  // A failed assertion inside a test body is the strong result; prefer it over a
  // softer crash match, because a crash string can also appear in an assertion diff.
  if (/\d+ failed/.test(out) && assertion.test(out) && !/Unhandled Error/.test(out)) return { verdict: 'assertion-red' };
  if (crash.test(out)) return { verdict: 'crash-red', why: out.match(crash)?.[0] };
  if (/failed/i.test(out)) return { verdict: 'assertion-red' };
  return { verdict: 'cannot verify', why: `vitest exited ${status} without a readable reason` };
}

const results = [];
for (const spec of added) {
  resetWorktree();
  stage(spec);
  const support = supportFor(spec);
  for (const s of support) stage(s);

  const run = trySh(vitestBin, ['run', spec, '--reporter=default', '--no-color'], {
    cwd: WT,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0', MIO_RED_CHECK: '1' },
    timeout: 180_000,
  });
  const { verdict, why } = classify(run.ok ? 0 : (run.status ?? 1), run.out ?? '');
  results.push({ spec, verdict, why, support, out: run.out ?? '' });

  const mark = { 'assertion-red': '✓', 'crash-red': '✓', GREEN: '✗', 'cannot verify': '✗' }[verdict];
  console.log(`${mark}  ${verdict.padEnd(14)} ${spec}${why ? `\n      ${why}` : ''}`);
  if (support.length) console.log(`      staged beside it: ${support.join(', ')}`);
}

rmSync(WT, { recursive: true, force: true });
trySh('git', ['worktree', 'prune']);

// --- verdict ----------------------------------------------------------------
const failures = [];
for (const res of results) {
  if (res.verdict === 'GREEN') {
    const ex = exemptions.find((e) => e.path === res.spec);
    if (ex) {
      console.log(`\n⚠  ${res.spec} is green at the base but exempt: "${ex.reason}"`);
      console.log('   The exemption excuses the verdict, not the reasoning. A reviewer must check it.');
    } else {
      failures.push(`${res.spec} PASSES at the merge-base. It does not need the implementation, so it guards nothing.\n` +
        `      Make it assert the new behaviour, or delete it. If the base genuinely cannot see the\n` +
        `      change, declare it: red-check-exempt: ${res.spec} — <why>`);
    }
  }
  if (res.verdict === 'cannot verify') {
    failures.push(`${res.spec} could not be executed at the merge-base (${res.why}). Failing closed: ` +
      'a file the gate cannot run is broken, not undecidable.');
  }
}

const counts = results.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {});
console.log(`\n${results.length} file(s): ` + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', '));
if (counts['crash-red']) {
  console.log(`   ${counts['crash-red']} of them are crash-red: they prove "cannot pass without the branch",`);
  console.log('   not "asserts the right thing". Prefer assertion-red where you can.');
}
if (failures.length) {
  for (const f of failures) console.log(`✗  ${f}`);
  console.log(`\nred-check: FAIL — ${failures.length} problem(s)`);
  process.exit(1);
}
console.log('\nred-check: PASS — every added test file fails without this branch.');
