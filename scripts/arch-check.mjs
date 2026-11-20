#!/usr/bin/env node
/**
 * arch-check — the source tree must agree with docs/architecture/architecture.yaml.
 *
 * The linter enforces the SHAPE of the architecture (which ring may import
 * which). This gate enforces the MODEL: which modules exist, what each one is
 * allowed to depend on, which events exist, and that every module carries its
 * own invariants file and its own tenant-isolation test.
 *
 * The distinction matters because the lint rule is generic — it would happily
 * allow `rewards` to start importing `gamification` tomorrow. Declaring the
 * edge here means a new coupling cannot appear without this file changing,
 * which a reviewer sees in the diff.
 *
 * Rules
 *   - a directory in src/modules that is not declared is an error;
 *   - a declared module with no directory is a NOTE while a card for it is
 *     still open on the board, and an error once that card is done (the model
 *     is allowed to describe the target, not to lie about the present);
 *   - a module that exists must have: index.ts (the facade), <name>.module.ts,
 *     domain/, application/, adapters/, AGENTS.md, and one *isolation*
 *     integration test;
 *   - every cross-module import found in code must be declared in dependsOn;
 *     a declared edge with no import is a warning (stale model);
 *   - platform must import no module;
 *   - every event name used in code must be declared by some module, and every
 *     declared event must exist in src/contracts/events.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ROOT, Report, readBoard, walk } from './lib/util.mjs';

const r = new Report('arch-check');
const model = parseYaml(readFileSync(join(ROOT, 'docs/architecture/architecture.yaml'), 'utf8'));
const declared = new Map(model.modules.map((m) => [m.name, m]));

const modulesDir = join(ROOT, 'src/modules');
const onDisk = existsSync(modulesDir)
  ? readdirSync(modulesDir).filter((d) => statSync(join(modulesDir, d)).isDirectory())
  : [];

const cards = readBoard();
const openCardFor = (moduleName) =>
  cards.find((c) => c.data?.module === moduleName && c.folder !== '5-done');

for (const dir of onDisk) {
  if (!declared.has(dir)) {
    r.error(`src/modules/${dir} exists but is not declared in architecture.yaml — add it (with its invariants) or remove it`);
  }
}

const tsFiles = walk(join(ROOT, 'src')).filter((f) => f.endsWith('.ts'));
const importsOf = (file) => {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
};
const moduleOfPath = (p) => {
  const m = /(?:^|\/)src\/modules\/([^/]+)\//.exec(`/${relative(ROOT, p)}`);
  return m?.[1] ?? null;
};
/**
 * Which module does this import specifier land in? A relative specifier has to be
 * resolved against the importing file first — `../../identity` names no module on
 * its face, which is how this gate used to miss every real cross-module import.
 */
const targetModuleOf = (spec, fromFile) => {
  const path = spec.startsWith('.')
    ? resolve(dirname(fromFile), spec)
    : spec.replace(/^@\//, `${join(ROOT, 'src')}/`);
  const m = /(?:^|\/)src\/modules\/([^/]+)(?:$|\/)/.exec(path);
  return m?.[1] ?? null;
};

// --- cross-module edges actually present in the code ------------------------
const actual = new Map();
for (const file of tsFiles) {
  if (/\.spec\.ts$/.test(file)) continue;
  const from = moduleOfPath(file);
  for (const spec of importsOf(file)) {
    const to = targetModuleOf(spec, file);
    if (!to) continue;
    if (/(?:^|\/)src\/platform\//.test(`/${relative(ROOT, file)}`)) {
      r.error(`${relative(ROOT, file)} imports module "${to}" — platform carries no business knowledge (ADR-0001)`);
      continue;
    }
    if (!from || from === to) continue;
    if (!actual.has(from)) actual.set(from, new Set());
    actual.get(from).add(to);
  }
}

for (const [name, decl] of declared) {
  const dir = join(modulesDir, name);
  if (!existsSync(dir)) {
    const card = openCardFor(name);
    if (card) r.note(`${name}: declared, not built yet (card ${card.data.id} in ${card.folder})`);
    else r.error(`${name} is declared in architecture.yaml but src/modules/${name} does not exist, and no open card covers it`);
    continue;
  }
  for (const required of ['index.ts', `${name}.module.ts`, 'domain', 'application', 'adapters', 'AGENTS.md']) {
    if (!existsSync(join(dir, required))) r.error(`src/modules/${name}: missing ${required}`);
  }
  const allowedAtRoot = new Set(['index.ts', `${name}.module.ts`, 'AGENTS.md', 'module.yaml']);
  for (const entry of readdirSync(dir)) {
    if (statSync(join(dir, entry)).isDirectory()) continue;
    if (!allowedAtRoot.has(entry)) {
      r.error(`src/modules/${name}/${entry}: a module root holds only index.ts (the facade), ${name}.module.ts (the wiring) and docs — everything else belongs in a ring`);
    }
  }
  const files = walk(dir).map((f) => relative(ROOT, f));
  if (!files.some((f) => /isolation.*\.integration\.spec\.ts$/.test(f))) {
    r.error(`src/modules/${name}: no tenant-isolation integration test (*isolation*.integration.spec.ts) — ADR-0006 requires one per module`);
  }

  const declaredDeps = new Set(decl.dependsOn ?? []);
  const found = actual.get(name) ?? new Set();
  for (const dep of found) {
    if (!declaredDeps.has(dep)) {
      r.error(`${name} imports ${dep} but architecture.yaml does not declare it in dependsOn — a new coupling is a reviewed decision`);
    }
  }
  for (const dep of declaredDeps) {
    if (!found.has(dep)) r.warn(`${name}: dependsOn declares ${dep}, but no import uses it (stale model)`);
  }
}

// --- events -----------------------------------------------------------------
const contractsDir = join(ROOT, 'src/contracts');
const declaredEvents = new Set(model.modules.flatMap((m) => [...(m.emits ?? []), ...(m.consumes ?? [])]));
if (existsSync(contractsDir)) {
  const contractText = walk(contractsDir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(f, 'utf8')).join('\n');
  const namesInContracts = new Set([...contractText.matchAll(/['"]((?:identity|integration|ingestion|gamification|ledger|rewards|casino)\.[a-z_]+\.[a-z_]+)['"]/g)].map((m) => m[1]));
  for (const name of declaredEvents) {
    if (!namesInContracts.has(name)) {
      const owner = model.modules.find((m) => (m.emits ?? []).includes(name));
      const card = owner ? openCardFor(owner.name) : null;
      if (card) r.note(`event ${name}: declared, no schema yet (card ${card.data.id})`);
      else r.error(`event ${name} is declared in architecture.yaml but has no schema in src/contracts/events`);
    }
  }
  for (const name of namesInContracts) {
    if (!declaredEvents.has(name)) r.error(`event ${name} has a schema but no module declares it in emits/consumes`);
  }
}

r.note(`${declared.size} modules declared, ${onDisk.length} on disk, ${declaredEvents.size} events`);
r.finish();
