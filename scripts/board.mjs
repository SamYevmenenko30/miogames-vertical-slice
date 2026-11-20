#!/usr/bin/env node
/**
 * board — the Jira board lives in git.
 *
 * `pnpm board`        print it.
 * `pnpm board:check`  enforce it:
 *   - a card's front-matter `column` equals the folder it sits in (a card moved
 *     with `mv` and not updated is the most common drift, and it makes the
 *     printed board lie);
 *   - ids are unique and the filename starts with the id;
 *   - at most ONE card in 3-in-progress — a WIP limit of one, which for a
 *     single agent is the difference between a finished ticket and three
 *     half-finished ones;
 *   - `depends_on` names cards that exist, and nothing in progress or later
 *     depends on a card still in backlog;
 *   - a card past 1-in-spec has a spec file;
 *   - every `Ticket:` trailer on this branch names a card that exists.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { COLUMNS, ROOT, Report, git, mergeBase, readBoard } from './lib/util.mjs';

const check = process.argv.includes('--check');
const cards = readBoard();
const byId = new Map(cards.map((c) => [c.data?.id, c]));

if (!check) {
  const done = cards.filter((c) => c.folder === '5-done').length;
  console.log(`\nMIO Games board — ${cards.length} cards, ${done} done\n`);
  for (const column of COLUMNS) {
    const here = cards.filter((c) => c.folder === column);
    console.log(`${column}  (${here.length})`);
    for (const c of here) {
      const title = String(c.data?.title ?? '').slice(0, 72);
      console.log(`  ${String(c.data?.id ?? '??').padEnd(9)} ${title}`);
      const g = c.data?.gates ?? {};
      const gates = Object.entries(g).map(([k, v]) => `${k}=${v}`).join(' ');
      if (gates && column !== '0-backlog') console.log(`${' '.repeat(12)}${gates}`);
    }
    if (!here.length) console.log('  —');
    console.log('');
  }
  process.exit(0);
}

const r = new Report('board:check');
const seen = new Set();
for (const c of cards) {
  const id = c.data?.id;
  if (!c.data) { r.error(`${c.file}: no front-matter`); continue; }
  if (!id) { r.error(`${c.file}: front-matter has no id`); continue; }
  if (seen.has(id)) r.error(`${id}: duplicate card (${c.file})`);
  seen.add(id);
  if (!c.file.split('/').pop().startsWith(id)) r.error(`${c.file}: filename does not start with ${id}`);
  if (c.data.column !== c.folder) {
    r.error(`${id}: front-matter says column "${c.data.column}" but the card is in ${c.folder}/ — a card is moved with \`git mv\` AND an edit`);
  }
  for (const dep of c.data.depends_on ?? []) {
    const d = byId.get(dep);
    if (!d) { r.error(`${id}: depends_on ${dep}, which is not a card`); continue; }
    const order = COLUMNS.indexOf(c.folder);
    if (order >= COLUMNS.indexOf('3-in-progress') && d.folder === '0-backlog') {
      r.error(`${id} is in ${c.folder} but depends on ${dep}, still in 0-backlog`);
    }
  }
  if (COLUMNS.indexOf(c.folder) >= COLUMNS.indexOf('2-in-tests')) {
    if (c.data.spec === 'none') {
      // An escape hatch with a reason, like every other declaration in this
      // pipeline. MIO-000 builds the gates themselves and has nothing to spec;
      // a card that waives its spec has to say why, in the card, where a
      // reviewer reads it.
      const why = String(c.data.spec_waiver ?? '');
      if (why.trim().length < 20) {
        r.error(`${id}: declares "spec: none" without a spec_waiver explaining why (at least a sentence)`);
      } else {
        r.warn(`${id}: no spec, waived — "${why}"`);
      }
    } else if (!c.data.spec || !existsSync(join(ROOT, c.data.spec))) {
      r.error(`${id}: is in ${c.folder} but has no spec at ${c.data.spec ?? '(unset)'}`);
    }
  }
}

const inProgress = cards.filter((c) => c.folder === '3-in-progress');
if (inProgress.length > 1) {
  r.error(`WIP limit is 1, found ${inProgress.length} in 3-in-progress: ${inProgress.map((c) => c.data.id).join(', ')}`);
}

const base = mergeBase();
const log = git('log', `${base}..HEAD`, '--pretty=%H%x00%B%x01');
for (const entry of log.split('\u0001')) {
  const [sha, message] = entry.split('\u0000');
  if (!sha || !message) continue;
  for (const m of message.matchAll(/^Ticket:\s*(MIO-\d+)\s*$/gm)) {
    if (!byId.has(m[1])) r.error(`commit ${sha.slice(0, 8)} has trailer "Ticket: ${m[1]}" but no such card exists`);
  }
}

r.note(`${cards.length} cards, ${inProgress.length} in progress, base ${base.slice(0, 8)}`);
r.finish();
