#!/usr/bin/env node
/**
 * verify — the one command before a push. Runs every gate that does not need
 * to know which ticket you are on, in the order that fails cheapest first.
 */
import { trySh } from './lib/util.mjs';

const steps = [
  ['lint (incl. hexagonal boundaries)', 'pnpm', ['lint']],
  ['typecheck', 'pnpm', ['typecheck']],
  ['arch-check', 'node', ['scripts/arch-check.mjs']],
  ['board:check', 'node', ['scripts/board.mjs', '--check']],
  ['docs-links', 'node', ['scripts/docs-links.mjs']],
  ['spec-gate', 'node', ['scripts/spec-gate.mjs']],
  ['test-guard', 'node', ['scripts/test-guard.mjs']],
  ['unit tests', 'pnpm', ['test:unit']],
  ['integration tests', 'pnpm', ['test:integration']],
  ['build', 'pnpm', ['build']],
  // The demo path, measured. MIO-011 found `pnpm dev` broken because nothing
  // automated ran it; this is the answer to that class of defect.
  ['smoke (all eight Part B steps, both operators)', 'pnpm', ['smoke']],
];

const failed = [];
for (const [label, cmd, args] of steps) {
  process.stdout.write(`\n──── ${label}\n`);
  const started = Date.now();
  const res = trySh(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (!res.ok) {
    console.log(res.out);
    console.log(`✗ ${label} FAILED in ${secs}s`);
    failed.push(label);
  } else {
    const tail = (res.out ?? '').trim().split('\n').slice(-3).join('\n');
    if (tail) console.log(tail);
    console.log(`✓ ${label} in ${secs}s`);
  }
}

console.log('');
if (failed.length) {
  console.log(`verify: FAIL — ${failed.join(', ')}`);
  process.exit(1);
}
console.log('verify: PASS');
