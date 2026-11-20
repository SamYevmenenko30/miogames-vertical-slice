#!/usr/bin/env node
/**
 * spec-gate — a ticket may not advance past the spec phase while a question
 * about its behaviour is unanswered.
 *
 * That is the whole point. An unanswered question is exactly where an agent
 * invents a product decision and buries it in an `if`. The gate makes the
 * question block the work instead.
 *
 * Checks, per spec:
 *   - the spec exists and its title names the ticket;
 *   - `## Behaviour spec` holds at least one `- **S<n> — ...**` statement;
 *   - S-ids are unique;
 *   - every `- **Q<n> ...**` bullet under `## Open questions` is answered, with
 *     a name and a date — or the section says "None.";
 *   - the ticket has a card, and the card points back at this spec.
 *
 * Usage: pnpm spec-gate            (every card past 0-backlog)
 *        pnpm spec-gate MIO-004    (one ticket)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLUMNS, ROOT, Report, readBoard } from './lib/util.mjs';

const only = process.argv.slice(2).find((a) => /^MIO-\d+$/.test(a));
const r = new Report(`spec-gate${only ? ` ${only}` : ''}`);
const cards = readBoard();

const targets = only
  ? cards.filter((c) => c.data?.id === only)
  : cards.filter((c) => COLUMNS.indexOf(c.folder) >= COLUMNS.indexOf('2-in-tests'));

if (only && !targets.length) r.error(`${only}: no card on the board`);

for (const card of targets) {
  const id = card.data.id;
  const specPath = card.data.spec ?? `docs/specs/${id}.md`;
  const abs = join(ROOT, specPath);
  if (!existsSync(abs)) { r.error(`${id}: no spec at ${specPath}`); continue; }
  const text = readFileSync(abs, 'utf8');

  const title = text.split('\n')[0] ?? '';
  if (!title.includes(id)) r.error(`${specPath}: the title line does not name ${id}`);

  // Split on headings rather than with a lookahead: JavaScript has no \Z, and the
  // first version of this gate used one — so it could not see the LAST section of a
  // file at all. `pnpm gate-probes` caught it; reading the code did not.
  const lines = text.split('\n');
  const section = (name) => {
    const start = lines.findIndex((l) => l.trim() === `## ${name}`);
    if (start === -1) return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^## /.test(lines[i])) { end = i; break; }
    }
    return lines.slice(start + 1, end).join('\n');
  };

  const behaviour = section('Behaviour spec');
  if (behaviour === null) { r.error(`${specPath}: no "## Behaviour spec" section`); continue; }
  const statements = [...behaviour.matchAll(/^- \*\*(S\d+)\b/gm)].map((m) => m[1]);
  if (!statements.length) r.error(`${specPath}: "## Behaviour spec" has no "- **S1 — ...**" statements`);
  const dupes = statements.filter((s, i) => statements.indexOf(s) !== i);
  if (dupes.length) r.error(`${specPath}: duplicate statement id(s): ${[...new Set(dupes)].join(', ')}`);

  const questions = section('Open questions');
  if (questions === null) {
    r.error(`${specPath}: no "## Open questions" section — write "None." if there genuinely are none`);
  } else {
    // Same reason: group the Q bullets by walking lines. A regex with a trailing
    // lookahead silently drops the last bullet, which is the one most likely to be open.
    const bullets = [];
    for (const line of questions.split('\n')) {
      const head = /^- \*\*(Q\d+)\b/.exec(line);
      if (head) bullets.push([null, head[1], line]);
      else if (bullets.length) bullets[bullets.length - 1][2] += `\n${line}`;
    }
    if (!bullets.length && !/^\s*None\.\s*$/m.test(questions)) {
      r.error(`${specPath}: "## Open questions" is neither a list of Q bullets nor "None."`);
    }
    for (const [, qid, body] of bullets) {
      if (!/\*\*Answered\*\*/.test(body)) {
        r.error(`${specPath} ${qid}: unanswered. A ticket does not leave the spec phase with an open question.`);
      } else if (!/\*\*Answered\*\*\s*\([^)]*\d{4}-\d{2}-\d{2}\)/.test(body)) {
        r.error(`${specPath} ${qid}: answered without "(who, YYYY-MM-DD)" — who decided is part of the answer`);
      }
    }
    r.note(`${id}: ${statements.length} statements, ${bullets.length} question(s)`);
  }
}

r.finish();
