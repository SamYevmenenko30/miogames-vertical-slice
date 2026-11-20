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
 *      crash-red      the file could not reach an assertion at all. Counts as
 *                     red — it cannot pass without the branch — but proves much
 *                     less: a test asserting NOTHING clears that bar too, as long
 *                     as it imports something the branch adds. So a ticket whose
 *                     added files are ALL crash-red does not pass on that alone
 *                     (see "crash-red is not a proof on its own" below).
 *      GREEN          the gate fails. The test does not need the branch.
 *      cannot verify  the runner could not execute the file, or the environment
 *                     (Postgres) was not there. FAILS CLOSED — never counted as
 *                     red, because "it was red" would be a claim about the
 *                     environment and not about the test.
 *
 * Honest limits
 *   - A crash-red proves "cannot pass without the branch", not "asserts the
 *     right thing". Prefer tests that fail on an assertion.
 *   - And `assertion-red` proves only that an AssertionError happened at the
 *     base. It does NOT prove that the assertion observed anything this branch
 *     does. `expect(existsSync('src/the-new-file.ts')).toBe(true)` fails at the
 *     base, passes here, and earns this gate's strongest verdict while guarding
 *     nothing at all — measured, beside a deliberately broken implementation and
 *     two other worthless tests, all green. The verdict is about the RUN. Whether
 *     the assertion is about the BEHAVIOUR is a judgement only a reader makes,
 *     and this gate cannot make it for them.
 *   - It measures the test files a branch ADDS. A new `it(...)` inside a spec file
 *     that already existed is never run at the merge-base, so the strongest claim
 *     in this pipeline does not cover it. Every test of the first fix round
 *     entered that way. The run below NAMES those files so the gap is at least
 *     visible, and `test-guard` requires a `test-fix:` declaration for each — but
 *     a declaration is a sentence, not a measurement. TD-0012.
 *   - node_modules is borrowed, so a test that writes through it reaches the
 *     current tree. Running the branch's test code IS the measurement; what the
 *     reset buys is that every channel not requiring that is closed.
 *   - A green verdict can be excused only by a declaration in a commit message
 *     on this branch, naming the exact path and a reason a reviewer can check:
 *
 *       red-check-exempt: <path> — <why the base run cannot see the change>
 *
 *   - A ticket whose added test files are ALL crash-red is not proven by this
 *     gate. Make at least one of them fail on an assertion, or declare each
 *     crash-red file, the same way:
 *
 *       crash-red-accepted: <path> — <why no assertion is reachable at the base>
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
const crashAccepted = [];
for (const message of git('log', `${base}..HEAD`, '--pretty=%B%x01').split('\u0001')) {
  for (const m of message.matchAll(/^red-check-exempt:\s*(\S+)\s*(?:—|--)\s*(.+)$/gm)) {
    exemptions.push({ path: m[1], reason: m[2].trim() });
  }
  for (const m of message.matchAll(/^crash-red-accepted:\s*(\S+)\s*(?:—|--)\s*(.+)$/gm)) {
    crashAccepted.push({ path: m[1], reason: m[2].trim() });
  }
}

/**
 * Spec files this branch MODIFIED. This gate cannot measure them — it stages one
 * added file into a clean base worktree, and a modified file's new cases only
 * exist in the context of the rest of that file — so the least it can do is say
 * which ones, rather than printing a verdict that sounds like it covered them.
 * (`test-guard` demands a declaration for each; a declaration is not a
 * measurement. TD-0012.)
 */
const modifiedSpecs = git('diff', '--name-status', '--diff-filter=M', `${base}..HEAD`)
  .split('\n').filter(Boolean)
  .map((l) => l.split('\t')[1])
  .filter((p) => /\.spec\.ts$/.test(p ?? ''));

console.log(`\nred-check — base ${base.slice(0, 8)}, ${added.length} added test file(s)\n`);
if (modifiedSpecs.length) {
  console.log(`⚠  ${modifiedSpecs.length} spec file(s) were MODIFIED, not added. This gate measures ADDED files, so`);
  console.log('   any test case added inside these was never run at the merge-base (TD-0012):');
  for (const p of modifiedSpecs) console.log(`     ${p}`);
  console.log('');
}
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
  // The DISCRIMINATOR is the error CLASS vitest prints above the code frame, not a
  // substring of the frame. vitest echoes the failing line, so `expect(x).toBe(y)`
  // appears in the output of a CRASH as well — which is how this gate reported a
  // plain `TypeError: f is not a function` as `assertion-red`, its strongest
  // verdict, for a run that never evaluated an expectation. An AssertionError
  // anywhere means some test really did reach an assertion and fail it; any other
  // error class with no AssertionError beside it means none did.
  const errorClasses = [...out.matchAll(/^\s*(?:FAIL\s+)?([A-Za-z]*Error)\s*:/gm)].map((m) => m[1]);
  const crashClass = errorClasses.find((c) => c !== 'AssertionError');
  if (crashClass && !errorClasses.includes('AssertionError')) {
    return { verdict: 'crash-red', why: `${crashClass} — the run never reached an assertion` };
  }
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
// --- crash-red is not a proof on its own, PER FILE --------------------------
// A crash-red file proves "this file cannot run without the branch". A test whose
// body is `expect(1).toBe(1)` proves that too, as soon as it imports anything the
// branch adds — so a crash-red file is not proved by this gate, and has to be
// declared.
//
// This rule used to be an AGGREGATE: it fired only when NO file in the ticket was
// assertion-red. One assertion-red file therefore switched it off for every
// crash-red sibling, undeclared — and the review drove exactly that through, with
// a deliberately broken implementation, a file-existence assertion as the licence,
// and two worthless tests beside it. Per file, because the question "was this
// file's redness worth anything?" is about that file and nothing else.
const crashRedFiles = results.filter((r) => r.verdict === 'crash-red');
const undeclaredCrashRed = crashRedFiles.filter((r) => !crashAccepted.some((a) => a.path === r.spec));
if (undeclaredCrashRed.length) {
  failures.push(
    `${undeclaredCrashRed.length} added test file(s) are crash-red and undeclared. crash-red proves only that\n` +
      '      a file cannot IMPORT this branch — a test asserting nothing clears that bar, so none fails on\n' +
      '      an assertion that this gate can vouch for. Make each one fail on an assertion, or declare it:\n' +
      undeclaredCrashRed.map((r) => `        crash-red-accepted: ${r.spec} — <why no assertion is reachable at the base>`).join('\n') +
      (counts['assertion-red']
        ? '\n      (An assertion-red sibling does not cover these. It used to, which is the defect being fixed.)'
        : ''));
} else if (crashRedFiles.length) {
  console.log(`\n⚠  ${crashRedFiles.length} added file(s) are crash-red, each explicitly accepted:`);
  for (const r of crashRedFiles) {
    const accepted = crashAccepted.find((a) => a.path === r.spec);
    console.log(`     ${r.spec} — "${accepted.reason}"`);
  }
  console.log('   The declaration excuses the verdict, not the reasoning. A reviewer must check it.');
}

if (failures.length) {
  for (const f of failures) console.log(`✗  ${f}`);
  console.log(`\nred-check: FAIL — ${failures.length} problem(s)`);
  process.exit(1);
}
console.log('\nred-check: PASS — every added test file fails without this branch.');
