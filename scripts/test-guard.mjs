#!/usr/bin/env node
/**
 * test-guard — a spec test is read-only once it exists.
 *
 * The failure mode this exists for: the implementation phase meets a failing
 * test, decides the test is wrong, and edits it until it passes. That is the
 * single easiest way to turn a spec-first pipeline into theatre, and it leaves
 * a diff that looks like ordinary work.
 *
 * So: any test file that existed at the merge-base and changed on this branch
 * needs a declaration, git-trailer style, in a commit message ON THIS BRANCH:
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
const changed = git('diff', '--name-status', `${base}..HEAD`)
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('\t'))
  .filter(([status, path]) => status.startsWith('M') && /\.spec\.ts$/.test(path ?? ''));

const declarations = [];
const log = git('log', `${base}..HEAD`, '--pretty=%B%x01');
for (const message of log.split('\u0001')) {
  for (const m of message.matchAll(/^spec-conflict:\s*(\S+)\s*(?:—|--)\s*(.+)$/gm)) {
    declarations.push({ target: m[1], reason: m[2].trim() });
  }
}

for (const [, path] of changed) {
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

if (!changed.length) r.note(`no pre-existing test file was modified (base ${base.slice(0, 8)})`);
r.finish();
