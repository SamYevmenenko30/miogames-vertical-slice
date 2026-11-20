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
  // A module with no tenant-owned rows still has an isolation property — it just
  // is not about a WHERE clause — so the test may be a unit test. What is not
  // negotiable is that the module HAS one.
  const isolationTests = files.filter((f) => /isolation.*\.spec\.ts$/.test(f));
  if (!isolationTests.length) {
    r.error(`src/modules/${name}: no tenant-isolation test (*isolation*.spec.ts) — ADR-0006 requires one per module`);
  }

  // Which ROLE the isolation test connects as decides what it can observe.
  // Row-level security does not apply to a table's owner, so an isolation test on
  // the owner connection proves the application-level scoping and says nothing
  // about the database layer it is named for — silently, while reading as though
  // it covered both. Either connect as the application role, or say why not.
  for (const test of isolationTests.filter((f) => f.endsWith('.integration.spec.ts'))) {
    const text = readFileSync(join(ROOT, test), 'utf8');
    const waiver = /arch-check:\s*owner-role-isolation\s*(?:—|--)\s*(.{15,})/.exec(text);
    // `startTestApi` composes the real application against testDb.appUrl, so a
    // suite that uses it is already on the application role. That trust is
    // checked once, below, rather than assumed here.
    if (/testDb\.appUrl|startTestApi/.test(text)) continue;
    if (waiver) {
      r.warn(`${test}: runs as the OWNER, so row-level security is not in force — "${waiver[1].trim().slice(0, 90)}"`);
      continue;
    }
    r.error(
      `${test}: an isolation integration test must connect as the APPLICATION role (createDatabase({ url: testDb.appUrl })),\n` +
        '      or declare why it cannot, in the file:\n' +
        '      // arch-check: owner-role-isolation — <why this case needs RLS off to be observable>',
    );
  }

  // The module's PUBLIC files may not re-export an adapter. The boundary lint
  // enforces this for index.ts, where it is a dependency from the facade; it
  // cannot for <name>.module.ts, which legitimately imports its own adapters to
  // wire them, and `export … from` is indistinguishable from `import` to the
  // plugin. So the same leak was available through the wiring file, and both
  // modules were using it to hand their consumers to a composition root.
  for (const publicFile of ['index.ts', `${name}.module.ts`]) {
    const path = join(dir, publicFile);
    if (!existsSync(path)) continue;
    const leak = /^export\s[^;]*\sfrom\s+['"][^'"]*adapters\//m.exec(readFileSync(path, 'utf8'));
    if (leak) {
      r.error(
        `src/modules/${name}/${publicFile}: re-exports an adapter (\`${leak[0].trim().slice(0, 70)}\`).\n` +
          "      A module's public surface is its facade and its wiring; neither may hand out an adapter class.\n" +
          '      Publish what the caller needs as a value instead — see GAMIFICATION_EVENT_HANDLERS.',
      );
    }
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

// The isolation-role rule above lets `startTestApi` stand in for an explicit
// application-role connection. That is only true while the helper actually points
// the application at the non-owner URL, so the stand-in is verified rather than
// trusted: if this ever changes, a dozen suites stop exercising row-level security
// at once and nothing else would say so.
const apiHelper = join(ROOT, 'src/test/api.helper.ts');
if (existsSync(apiHelper) && !/DATABASE_URL:\s*db\.appUrl/.test(readFileSync(apiHelper, 'utf8'))) {
  r.error(
    'src/test/api.helper.ts no longer points DATABASE_URL at db.appUrl — every suite that uses\n' +
      '      startTestApi has silently stopped running as the application role, so row-level security\n' +
      '      is not in force for any of them.',
  );
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
