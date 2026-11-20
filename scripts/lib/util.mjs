import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const COLUMNS = ['0-backlog', '1-in-spec', '2-in-tests', '3-in-progress', '4-in-review', '5-done'];

export function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}
export function trySh(cmd, args, opts = {}) {
  try {
    return { ok: true, out: sh(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`, status: e.status ?? 1 };
  }
}
export const git = (...args) => sh('git', args).trim();

/** The commit this branch grew from. Falls back to the root commit on a fresh repo. */
export function mergeBase(base = process.env.MIO_BASE_REF || 'origin/main') {
  const candidates = [base, 'main', 'master'];
  for (const ref of candidates) {
    const r = trySh('git', ['merge-base', 'HEAD', ref]);
    if (r.ok && r.out.trim()) return r.out.trim();
  }
  return git('rev-list', '--max-parents=0', 'HEAD').split('\n').pop().trim();
}

export function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function frontMatter(file) {
  const text = readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { data: null, body: text };
  return { data: parseYaml(m[1]), body: text.slice(m[0].length) };
}

/** Every card on the board, with the column it actually sits in. */
export function readBoard() {
  const cards = [];
  for (const column of COLUMNS) {
    for (const file of walk(join(ROOT, 'board', column))) {
      if (!file.endsWith('.md')) continue;
      const { data, body } = frontMatter(file);
      cards.push({ file: relative(ROOT, file), folder: column, data, body });
    }
  }
  return cards;
}

export class Report {
  constructor(name) { this.name = name; this.errors = []; this.warnings = []; this.notes = []; }
  error(msg) { this.errors.push(msg); return this; }
  warn(msg) { this.warnings.push(msg); return this; }
  note(msg) { this.notes.push(msg); return this; }
  finish() {
    for (const n of this.notes) console.log(`   ${n}`);
    for (const w of this.warnings) console.log(`⚠  ${w}`);
    for (const e of this.errors) console.log(`✗  ${e}`);
    if (this.errors.length) {
      console.log(`\n${this.name}: FAIL — ${this.errors.length} problem(s)`);
      process.exit(1);
    }
    console.log(`\n${this.name}: PASS${this.warnings.length ? ` (${this.warnings.length} warning(s))` : ''}`);
  }
}
