#!/usr/bin/env node
/**
 * review:request — run everything, then print the block that goes into the
 * ticket's card under "## Phase log" / "## Review findings".
 *
 * The point of printing it rather than just exiting zero: the card, not the
 * terminal, is where the evidence has to survive. `docs/ai/gate-runs/` keeps
 * the raw output.
 *
 * Usage: pnpm review:request MIO-004
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, git, mergeBase, trySh } from './lib/util.mjs';

const ticket = process.argv.slice(2).find((a) => /^MIO-\d+$/.test(a));
if (!ticket) {
  console.log('usage: pnpm review:request MIO-004');
  process.exit(2);
}

const steps = [
  ['spec-gate', 'node', ['scripts/spec-gate.mjs', ticket]],
  ['red-check', 'node', ['scripts/red-check.mjs']],
  ['test-guard', 'node', ['scripts/test-guard.mjs']],
  ['arch-check', 'node', ['scripts/arch-check.mjs']],
  ['board:check', 'node', ['scripts/board.mjs', '--check']],
  ['lint', 'pnpm', ['lint']],
  ['typecheck', 'pnpm', ['typecheck']],
  ['tests', 'pnpm', ['test']],
  ['build', 'pnpm', ['build']],
  ['gate-probes', 'node', ['scripts/gate-probes.mjs']],
];

const base = mergeBase();
const head = git('rev-parse', 'HEAD');
const results = [];
const dir = join(ROOT, 'docs/ai/gate-runs');
mkdirSync(dir, { recursive: true });

for (const [label, cmd, args] of steps) {
  process.stdout.write(`──── ${label} … `);
  const t = Date.now();
  const res = trySh(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  console.log(res.ok ? `PASS (${secs}s)` : `FAIL (${secs}s)`);
  if (!res.ok) console.log((res.out ?? '').trim().split('\n').slice(-20).join('\n'));
  results.push({ label, ok: res.ok, secs, out: res.out ?? '' });
}

const transcript = results.map((r) => `$ ${r.label}\n${r.out.trim()}\n`).join('\n');
const file = join(dir, `${ticket}-review-request.txt`);
writeFileSync(file, `# ${ticket} — review:request\n# base ${base}\n# head ${head}\n\n${transcript}`);

const failed = results.filter((r) => !r.ok);
const row = (r) => `| \`${r.label}\` | ${r.ok ? 'PASS' : '**FAIL**'} | ${r.secs}s |`;
console.log(`
─────────────── paste into board card for ${ticket} ───────────────
Gates on ${head.slice(0, 8)} (base ${base.slice(0, 8)}):

| Gate | Result | Time |
| --- | --- | --- |
${results.map(row).join('\n')}

Raw output: \`docs/ai/gate-runs/${ticket}-review-request.txt\`
───────────────────────────────────────────────────────────────────`);

if (failed.length) {
  console.log(`\nreview:request: FAIL — ${failed.map((f) => f.label).join(', ')}`);
  process.exit(1);
}
console.log('\nreview:request: PASS — the ticket may move to 4-in-review.');
