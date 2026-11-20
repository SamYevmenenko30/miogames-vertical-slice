#!/usr/bin/env node
/**
 * test-guard — a spec test is read-only once it exists.
 *
 * The failure mode this exists for: the implementation phase meets a failing
 * test, decides the test is wrong, and edits it until it passes. That is the
 * single easiest way to turn a spec-first pipeline into theatre, and it leaves
 * a diff that looks like ordinary work.
 *
 * Two shapes of the same move:
 *
 *   1. a test file that existed at the merge-base and changed on this branch;
 *   2. a test file this BRANCH added, and then changed in a later commit on the
 *      same branch. `git diff base..HEAD` reports that one as merely "added", so
 *      it is invisible to the obvious check — and it is the common case when one
 *      branch carries all three phases, which is exactly the shape this
 *      pipeline uses.
 *
 * Either needs a declaration, git-trailer style, in a commit message ON THIS
 * BRANCH:
 *
 *   spec-conflict: <path or basename> — <what the spec gets wrong>
 *
 * The trailer is not an escape hatch, it is a signal: it sends the ticket back
 * to the spec phase, and the reason after the dash is what the next session
 * reads. A modification with no such line fails the gate.
 */
import { Report, git, mergeBase } from './lib/util.mjs';

const r = new Report('test-guard');
const base = mergeBase();
const diff = git('diff', '--name-status', `${base}..HEAD`)
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('\t'));

const changed = diff.filter(([status, path]) => status.startsWith('M') && /\.spec\.ts$/.test(path ?? ''));

// Shape 2: added by this branch, then touched again by a later commit on it.
const addedSpecs = diff
  .filter(([status, path]) => status.startsWith('A') && /\.spec\.ts$/.test(path ?? ''))
  .map(([, path]) => path);
const editedAfterAdding = addedSpecs.filter((path) => {
  const commits = git('log', '--format=%H', `${base}..HEAD`, '--', path).split('\n').filter(Boolean);
  return commits.length > 1;
});

const declarations = [];
const log = git('log', `${base}..HEAD`, '--pretty=%B%x01');
for (const message of log.split('\u0001')) {
  for (const m of message.matchAll(/^spec-conflict:\s*(\S+)\s*(?:—|--)\s*(.+)$/gm)) {
    declarations.push({ target: m[1], reason: m[2].trim() });
  }
}

for (const path of [...changed.map(([, p]) => p), ...editedAfterAdding]) {
  const base_ = path.split('/').pop();
  const found = declarations.find((d) => d.target === path || d.target === base_);
  if (!found) {
    r.error(`${path} was modified on this branch with no declaration. If the spec is wrong, commit:\n` +
            `      spec-conflict: ${path} — <what the spec gets wrong>\n` +
            `   If the spec is right, fix the code instead.`);
  } else if (found.reason.length < 15) {
    r.error(`${path}: the spec-conflict declaration has no real reason ("${found.reason}")`);
  } else {
    r.warn(`${path}: modified under spec-conflict — "${found.reason}". The ticket goes back to the spec phase.`);
  }
}

if (!changed.length && !editedAfterAdding.length) {
  r.note(`no test file was modified after it was written (base ${base.slice(0, 8)}, ${addedSpecs.length} added)`);
}
r.finish();
