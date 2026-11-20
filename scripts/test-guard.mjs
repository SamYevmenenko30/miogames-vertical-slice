#!/usr/bin/env node
/**
 * test-guard — a spec test is read-only once it exists, and a committed test runs.
 *
 * The failure mode this exists for: the implementation phase meets a failing
 * test, decides the test is wrong, and makes it stop failing. That is the single
 * easiest way to turn a spec-first pipeline into theatre, and it leaves a diff
 * that looks like ordinary work.
 *
 * FOUR shapes of that same move, which is three more than this gate used to see.
 * It inspected `M` and `A`-then-touched-again, and the round-two review walked
 * straight past it twice:
 *
 *   1. MODIFIED — a test file that existed at the merge-base and changed here.
 *   2. ADDED, then changed in a later commit on the same branch. `git diff
 *      base..HEAD` reports that one as merely "added", so it is invisible to the
 *      obvious check — and it is the common case when one branch carries all
 *      three phases, which is exactly the shape this pipeline uses.
 *   3. DELETED. `git rm` of a spec file and the gate printed "no test file was
 *      modified after it was written" as reassurance, which was true and useless:
 *      thirteen tests were gone and `pnpm verify` was green because they were
 *      gone. Deleting a test is strictly easier than bending one.
 *   4. RENAMED and edited in one commit. Git reports `R098` — it is saying *in
 *      the status itself* that the file was modified — and that matched neither
 *      filter. A rename with no edit at all is a move, and passes with a note.
 *
 * And one shape that is not a diff at all: a test that is committed but does not
 * RUN. Nothing here checked for `it.only` (which disables every sibling in the
 * file) or `it.skip` / `.todo` (which satisfies `pnpm verify` while asserting
 * nothing). Both are the same lie as a bent test, told more cheaply.
 *
 * Every one of them needs a declaration, git-trailer style, in a commit message
 * ON THIS BRANCH:
 *
 *   spec-conflict: <path or basename> — <what the spec gets wrong>
 *   test-fix:      <path or basename> — <what was wrong with the test>
 *   test-removed:  <path or basename> — <why the statement it proved is gone>
 *   test-skipped:  <path or basename> — <why it may not run, and when it will>
 *
 * The trailer is not an escape hatch, it is a signal: `spec-conflict:` sends the
 * ticket back to the spec phase, and the reason after the dash is what the next
 * session reads. A change with no such line fails the gate.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Report, ROOT, git, mergeBase, walk } from './lib/util.mjs';

const r = new Report('test-guard');
const base = mergeBase();
const isSpec = (p) => /\.spec\.ts$/.test(p ?? '');

/**
 * `--name-status -M` emits TWO fields for most statuses and THREE for a rename or
 * a copy: `R098  old  new`. Reading field [1] as "the path" therefore read the OLD
 * path of a rename, which is how shape 4 went unnoticed.
 */
const diff = git('diff', '--name-status', '-M', `${base}..HEAD`)
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [status, first, second] = line.split('\t');
    const renamed = status.startsWith('R') || status.startsWith('C');
    return {
      status,
      path: renamed ? second : first,
      from: renamed ? first : null,
      // `R100` / `C100` is a pure move: same bytes, different path.
      similarity: renamed ? Number(status.slice(1)) : null,
    };
  });

/** Shape 1 and shape 4: the content of a pre-existing spec changed. */
const changed = diff.filter((d) => isSpec(d.path) && (d.status.startsWith('M') || (d.from && d.similarity !== 100)));

/** Shape 3: the spec is gone. */
const deleted = diff.filter((d) => d.status.startsWith('D') && isSpec(d.path));

/** A pure move. Nothing was bent, so it is a note — but it is never silent. */
const moved = diff.filter((d) => d.from && d.similarity === 100 && isSpec(d.path));

// Shape 2: added by this branch, then touched again by a later commit on it.
const addedSpecs = diff.filter((d) => d.status.startsWith('A') && isSpec(d.path)).map((d) => d.path);
const editedAfterAdding = addedSpecs.filter((path) => {
  const commits = git('log', '--format=%H', `${base}..HEAD`, '--', path).split('\n').filter(Boolean);
  return commits.length > 1;
});

const KINDS = ['spec-conflict', 'test-fix', 'test-removed', 'test-skipped'];
const declarations = [];
const log = git('log', `${base}..HEAD`, '--pretty=%B%x01');
for (const message of log.split('\u0001')) {
  for (const kind of KINDS) {
    for (const m of message.matchAll(new RegExp(`^${kind}:\\s*(\\S+)\\s*(?:—|--)\\s*(.+)$`, 'gm'))) {
      declarations.push({ kind, target: m[1], reason: m[2].trim() });
    }
  }
}

const declarationFor = (path, kinds) => {
  const basename = path.split('/').pop();
  return declarations.find((d) => kinds.includes(d.kind) && (d.target === path || d.target === basename));
};

/** One rule, applied to each shape: a change to a spec test is declared or it fails. */
function require_(path, kinds, how, suggestion) {
  const found = declarationFor(path, kinds);
  if (!found) {
    r.error(`${path} ${how} on this branch with no declaration.\n${suggestion}`);
    return;
  }
  if (found.reason.length < 15) {
    r.error(`${path}: the ${found.kind} declaration has no real reason ("${found.reason}")`);
  } else if (found.kind === 'spec-conflict') {
    r.warn(`${path}: ${how} under spec-conflict — "${found.reason}". The ticket goes back to the spec phase.`);
  } else {
    r.note(`${path}: ${how} under ${found.kind} — "${found.reason}".`);
  }
}

for (const path of [...changed.map((d) => d.path), ...editedAfterAdding]) {
  require_(
    path,
    ['spec-conflict', 'test-fix'],
    'was modified',
    `      If the SPEC is wrong, commit:\n` +
      `        spec-conflict: ${path} — <what the spec gets wrong>\n` +
      `      If the TEST is wrong — a broken fixture, a weak assertion, an added case — commit:\n` +
      `        test-fix: ${path} — <what was wrong with the test>\n` +
      `      If both are right, fix the code instead.`,
  );
}

for (const { path } of deleted) {
  require_(
    path,
    ['test-removed', 'spec-conflict'],
    'was DELETED',
    `      A deleted test is a statement nobody proves any more, and the suite goes green\n` +
      `      because of it. Say which statement left with it:\n` +
      `        test-removed: ${path} — <why the statement it proved is gone>\n` +
      `      If the spec it came from is what is wrong, commit spec-conflict: instead.`,
  );
}

for (const { path, from, status } of moved) {
  r.note(`${path}: moved from ${from} with no edit (${status}). Nothing was bent — but ` +
         'red-check measures ADDED files, so the move is not re-measured either.');
}

/**
 * The shape that leaves no diff: a committed test that does not run.
 *
 * Scanned across the whole tree, not just the branch's changes, because a `.only`
 * left behind anywhere silences its file for everybody from then on — the damage
 * is in the file's present state, not in who last touched it.
 */
const only = [];
const skipped = [];
for (const file of walk(join(ROOT, 'src'))) {
  if (!isSpec(file)) continue;
  const path = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/^.*\b(?:it|test|describe|suite)\.(only|skip|todo)\b(?!If)/gm)) {
    const line = text.slice(0, m.index).split('\n').length;
    (m[1] === 'only' ? only : skipped).push({ path, line, what: m[1] });
  }
}

for (const { path, line, what } of only) {
  // No declaration route on purpose. `.only` is never what a committed test wants:
  // it does not weaken one assertion, it silences every other test in the file.
  r.error(`${path}:${line} commits \`.${what}\`, which disables every other test in the file. ` +
          'Remove it — there is no declaration for this one.');
}
for (const { path, line, what } of skipped) {
  const found = declarationFor(path, ['test-skipped']);
  if (!found) {
    r.error(`${path}:${line} commits \`.${what}\`, so it satisfies \`pnpm verify\` without asserting anything.\n` +
            `      Delete it, or say why it may not run and when it will:\n` +
            `        test-skipped: ${path} — <why it may not run, and when it will>`);
  } else if (found.reason.length < 15) {
    r.error(`${path}: the test-skipped declaration has no real reason ("${found.reason}")`);
  } else {
    r.warn(`${path}:${line} is skipped under test-skipped — "${found.reason}".`);
  }
}

if (!changed.length && !editedAfterAdding.length && !deleted.length) {
  r.note(`no test file was modified or deleted after it was written (base ${base.slice(0, 8)}, ${addedSpecs.length} added)`);
}
if (!only.length && !skipped.length) {
  r.note('every committed spec test runs: no `.only`, `.skip` or `.todo` anywhere under src/');
}
r.finish();
