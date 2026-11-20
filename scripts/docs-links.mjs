#!/usr/bin/env node
/**
 * docs-links — every relative markdown link must resolve.
 *
 * A broken link is the first thing a reviewer hits and the cheapest possible
 * defect to not ship, and this repository's whole argument is that a claim worth
 * making is worth checking. The documents here cross-reference heavily — ADRs,
 * specs, cards, the architecture model — so the links rot exactly as fast as the
 * prose does.
 *
 * It found one on its first run, in a document written minutes earlier.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ROOT, Report } from './lib/util.mjs';

const SKIP = new Set(['node_modules', '.git', '.tmp', 'dist', 'coverage']);

function markdownFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) markdownFiles(path, out);
    else if (path.endsWith('.md')) out.push(path);
  }
  return out;
}

const r = new Report('docs-links');
let checked = 0;

for (const file of markdownFiles(ROOT)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    checked += 1;
    if (!existsSync(resolve(dirname(file), target))) {
      r.error(`${relative(ROOT, file)} links to ${target}, which does not exist`);
    }
  }
}

r.note(`${checked} relative links checked`);
r.finish();
