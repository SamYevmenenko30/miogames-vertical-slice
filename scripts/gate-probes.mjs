#!/usr/bin/env node
/**
 * gate-probes — do the gates actually bite?
 *
 * A gate that has never been observed to fail is indistinguishable from a gate
 * that silently passes everything. This has happened to me on a larger project:
 * three gates had been dead for weeks, each exiting zero while printing a
 * verdict nobody read.
 *
 * So every probe does two runs in a scratch worktree:
 *   1. BASELINE — the gate passes on an unmodified tree. Without this, a probe
 *      "succeeds" whenever the gate is broken for an unrelated reason.
 *   2. VIOLATION — a known-bad change is planted, and the gate must exit
 *      non-zero AND say the expected thing. Exiting non-zero for the wrong
 *      reason is a failed probe.
 *
 * Usage: pnpm gate-probes [name-fragment]
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { COLUMNS, ROOT, sh, trySh } from './lib/util.mjs';

const WT = join(ROOT, '.tmp', `probe-wt-${process.pid}`);
const filter = process.argv.slice(2).find((a) => !a.startsWith('-'));

const write = (rel, text) => {
  const p = join(WT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};
const run = (cmd, args) => trySh(cmd, args, { cwd: WT, env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, timeout: 300_000 });
const commit = (msg) => {
  sh('git', ['-C', WT, 'add', '-A'], { stdio: 'ignore' });
  sh('git', ['-C', WT, 'commit', '-q', '--no-verify', '-m', msg], { stdio: 'ignore' });
  return sh('git', ['-C', WT, 'rev-parse', 'HEAD']).trim();
};

/**
 * Any two cards currently on the board, wherever they are.
 *
 * The first version of the board probes named cards by path, and silently broke
 * the moment those cards moved to another column — a probe that cannot run is a
 * gate that is no longer probed.
 */
function someCards(count) {
  const found = [];
  for (const column of COLUMNS) {
    const dir = join(WT, 'board', column);
    let entries = [];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      found.push({ column, name, path: join(dir, name) });
      if (found.length === count) return found;
    }
  }
  if (found.length < count) throw new Error(`gate-probes needs ${count} cards on the board, found ${found.length}`);
  return found;
}

/** A module skeleton, so a boundary probe has somewhere legal to stand. */
function scaffoldModule(name, deps = []) {
  write(`src/modules/${name}/domain/${name}.ts`, `export const ${name}Marker = '${name}' as const;\n`);
  write(`src/modules/${name}/application/${name}.facade.ts`, `export class ${name}Facade {}\nexport const ${name}Facade_ = '${name}' as const;\n`);
  write(`src/modules/${name}/adapters/out/.keep`, '');
  write(`src/modules/${name}/index.ts`, `export { ${name}Facade } from './application/${name}.facade';\nexport { ${name}Marker } from './domain/${name}';\n`);
  write(`src/modules/${name}/${name}.module.ts`, `import { Module } from '@nestjs/common';\nimport { ${name}Facade } from './application/${name}.facade';\n\n@Module({ providers: [${name}Facade], exports: [${name}Facade] })\nexport class ${name[0].toUpperCase()}${name.slice(1)}Module {}\n`);
  write(`src/modules/${name}/AGENTS.md`, `# ${name}\n\nProbe scaffold.\n`);
  write(`src/modules/${name}/__tests__/${name}-isolation.integration.spec.ts`, `import { it } from 'vitest';\n\nit('S0 — probe', () => {});\n`);
  void deps;
}

const probes = [
  {
    name: 'lint/domain-ring-stays-pure',
    gate: ['pnpm', ['lint']],
    expect: /domain ring stays free of framework/i,
    plant() {
      scaffoldModule('ledger');
      write('src/modules/ledger/domain/entry.ts',
        `import { Injectable } from '@nestjs/common';\n\n@Injectable()\nexport class Entry {}\n`);
    },
  },
  {
    name: 'lint/no-deep-import-across-modules',
    gate: ['pnpm', ['lint']],
    expect: /no policy allowing dependencies from elements of type "module-application"[\s\S]*?"module-domain"/i,
    plant() {
      scaffoldModule('ledger');
      scaffoldModule('rewards');
      write('src/modules/rewards/application/redeem.ts',
        `import { ledgerMarker } from '../../ledger/domain/ledger';\n\nexport const used = ledgerMarker;\n`);
    },
  },
  {
    name: 'lint/application-may-not-reach-into-an-adapter',
    gate: ['pnpm', ['lint']],
    expect: /no policy allowing dependencies from elements of type "module-application"[\s\S]*?"module-adapter-out"/i,
    plant() {
      scaffoldModule('ledger');
      write('src/modules/ledger/adapters/out/entry.repository.ts', `export const repo = 'pg';\n`);
      write('src/modules/ledger/application/credit.ts',
        `import { repo } from '../adapters/out/entry.repository';\n\nexport const used = repo;\n`);
    },
  },
  {
    name: 'lint/a-facade-may-not-re-export-an-adapter',
    gate: ['pnpm', ['lint']],
    expect: /no policy allowing dependencies from[\s\S]*?category "facade"[\s\S]*?"module-adapter-out"/i,
    plant() {
      scaffoldModule('ledger');
      write('src/modules/ledger/adapters/out/entry.repository.ts', `export const repo = 'pg';\n`);
      write('src/modules/ledger/index.ts',
        `export { ledgerFacade } from './application/ledger.facade';\nexport { repo } from './adapters/out/entry.repository';\n`);
    },
  },
  {
    name: 'arch-check/stray-file-at-a-module-root',
    gate: ['node', ['scripts/arch-check.mjs']],
    expect: /a module root holds only/i,
    plant() {
      scaffoldModule('ledger');
      write('src/modules/ledger/helpers.ts', `export const help = 1;\n`);
    },
  },
  {
    name: 'lint/config-read-outside-platform-config',
    gate: ['pnpm', ['lint']],
    expect: /platform\/config/i,
    plant() {
      scaffoldModule('ledger');
      write('src/modules/ledger/application/sneaky.ts',
        `export const url = process.env.DATABASE_URL ?? '';\n`);
    },
  },
  {
    name: 'arch-check/undeclared-module',
    gate: ['node', ['scripts/arch-check.mjs']],
    expect: /is not declared in architecture\.yaml/i,
    plant() { scaffoldModule('pvp'); },
  },
  {
    name: 'arch-check/platform-importing-a-module',
    gate: ['node', ['scripts/arch-check.mjs']],
    expect: /platform carries no business knowledge/i,
    plant() {
      scaffoldModule('ledger');
      write('src/platform/db/leak.ts', `import { ledgerMarker } from '../../modules/ledger/domain/ledger';\n\nexport const x = ledgerMarker;\n`);
    },
  },
  {
    name: 'arch-check/undeclared-cross-module-import',
    gate: ['node', ['scripts/arch-check.mjs']],
    expect: /does not declare it in dependsOn/i,
    plant() {
      scaffoldModule('ledger');
      scaffoldModule('identity');
      // ledger declares dependsOn: [] in the model, so this edge is undeclared.
      write('src/modules/ledger/application/peek.ts',
        `import { identityMarker } from '../../identity';\n\nexport const x = identityMarker;\n`);
    },
  },
  {
    name: 'arch-check/module-without-isolation-test',
    gate: ['node', ['scripts/arch-check.mjs']],
    expect: /no tenant-isolation test/i,
    plant() {
      scaffoldModule('ledger');
      rmSync(join(WT, 'src/modules/ledger/__tests__'), { recursive: true, force: true });
    },
  },
  {
    name: 'spec-gate/unanswered-open-question',
    gate: ['node', ['scripts/spec-gate.mjs', 'MIO-999']],
    expect: /unanswered\. A ticket does not leave the spec phase/i,
    setup() {
      write('board/2-in-tests/MIO-999-probe.md',
        `---\nid: MIO-999\ntitle: "probe"\ncolumn: 2-in-tests\ntype: feature\nmodule: ledger\npart: "C"\ndepends_on: []\nspec: docs/specs/MIO-999.md\n---\n\n# probe\n`);
      write('docs/specs/MIO-999.md',
        `# SPEC: MIO-999 — probe\n\n## Behaviour spec\n\n- **S1 — something.** It does something.\n\n## Open questions\n\n- **Q1 — should a refund be partial?** → **Answered** (Sam, 2026-11-20): no, all or nothing.\n`);
    },
    plant() {
      write('docs/specs/MIO-999.md',
        `# SPEC: MIO-999 — probe\n\n## Behaviour spec\n\n- **S1 — something.** It does something.\n\n## Open questions\n\n- **Q1 — should a refund be partial?** Nobody has decided.\n`);
    },
  },
  {
    name: 'spec-gate/a-bullet-that-is-not-a-question',
    gate: ['node', ['scripts/spec-gate.mjs', 'MIO-999']],
    expect: /is a bullet under "## Open questions" that is not a/i,
    setup() {
      write('board/2-in-tests/MIO-999-probe.md',
        `---\nid: MIO-999\ntitle: "probe"\ncolumn: 2-in-tests\ntype: feature\nmodule: ledger\npart: "C"\ndepends_on: []\nspec: docs/specs/MIO-999.md\n---\n\n# probe\n`);
      write('docs/specs/MIO-999.md',
        `# SPEC: MIO-999 — probe\n\n## Behaviour spec\n\n- **S1 — something.** It does something.\n\n## Open questions\n\n- **Q1 — should a refund be partial?** → **Answered** (Sam, 2026-11-20): no.\n`);
    },
    plant() {
      write('docs/specs/MIO-999.md',
        `# SPEC: MIO-999 — probe\n\n## Behaviour spec\n\n- **S1 — something.** It does something.\n\n## Open questions\n\n- **S/Q1 — should a refund be partial?** Nobody has decided.\n`);
    },
  },
  {
    name: 'spec-gate/answer-without-an-owner',
    gate: ['node', ['scripts/spec-gate.mjs', 'MIO-999']],
    expect: /answered without "\(who, YYYY-MM-DD\)"/i,
    setup() {
      write('board/2-in-tests/MIO-999-probe.md',
        `---\nid: MIO-999\ntitle: "probe"\ncolumn: 2-in-tests\ntype: feature\nmodule: ledger\npart: "C"\ndepends_on: []\nspec: docs/specs/MIO-999.md\n---\n\n# probe\n`);
      write('docs/specs/MIO-999.md',
        `# SPEC: MIO-999 — probe\n\n## Behaviour spec\n\n- **S1 — something.** It does something.\n\n## Open questions\n\n- **Q1 — should a refund be partial?** → **Answered** (Sam, 2026-11-20): no, all or nothing.\n`);
    },
    plant() {
      write('docs/specs/MIO-999.md',
        `# SPEC: MIO-999 — probe\n\n## Behaviour spec\n\n- **S1 — something.** It does something.\n\n## Open questions\n\n- **Q1 — should a refund be partial?** → **Answered**: yes, fully.\n`);
    },
  },
  {
    name: 'board/column-drift',
    gate: ['node', ['scripts/board.mjs', '--check']],
    expect: /front-matter says column/i,
    plant() {
      const [card] = someCards(1);
      const target = card.column === '3-in-progress' ? '4-in-review' : '3-in-progress';
      mkdirSync(join(WT, 'board', target), { recursive: true });
      renameSync(card.path, join(WT, 'board', target, card.name));
    },
  },
  {
    name: 'board/spec-waiver-without-a-reason',
    gate: ['node', ['scripts/board.mjs', '--check']],
    expect: /without a spec_waiver explaining why/i,
    plant() {
      // Whichever card waives its spec — named by its waiver, not by its path.
      const waived = COLUMNS.flatMap((column) => {
        const dir = join(WT, 'board', column);
        let entries = [];
        try { entries = readdirSync(dir); } catch { return []; }
        return entries
          .filter((name) => name.endsWith('.md'))
          .map((name) => join(dir, name))
          .filter((path) => /^spec:\s*none\s*$/m.test(readFileSync(path, 'utf8')));
      });
      if (waived.length === 0) throw new Error('no card waives its spec, so this probe has nothing to plant');
      const text = readFileSync(waived[0], 'utf8').replace(/^spec_waiver:.*$/m, 'spec_waiver: ""');
      writeFileSync(waived[0], text);
    },
  },
  {
    name: 'board/wip-limit-of-one',
    gate: ['node', ['scripts/board.mjs', '--check']],
    expect: /WIP limit is 1/i,
    plant() {
      mkdirSync(join(WT, 'board/3-in-progress'), { recursive: true });
      for (const card of someCards(2)) {
        const text = readFileSync(card.path, 'utf8').replace(/^column: .*$/m, 'column: 3-in-progress');
        writeFileSync(join(WT, 'board/3-in-progress', card.name), text);
        rmSync(card.path);
      }
    },
  },
  {
    name: 'board/commit-trailer-names-a-ghost-card',
    gate: ['node', ['scripts/board.mjs', '--check']],
    expect: /no such card exists/i,
    plant() {
      write('docs/notes-probe.md', 'probe\n');
      commit('chore: probe\n\nTicket: MIO-777\n');
    },
  },
  {
    name: 'test-guard/spec-test-edited-without-a-declaration',
    gate: ['node', ['scripts/test-guard.mjs']],
    expectEnv: (base) => ({ MIO_BASE_REF: base }),
    expect: /was modified on this branch with no declaration/i,
    plant() {
      write('src/probe-guard.spec.ts', `import { expect, it } from 'vitest';\n\nit('S1 — probe', () => { expect(1).toBe(1); });\n`);
      const base = commit('test: probe baseline\n');
      write('src/probe-guard.spec.ts', `import { expect, it } from 'vitest';\n\nit('S1 — probe', () => { expect(1).toBe(2); });\n`);
      commit('fix: bend the test\n');
      return base;
    },
  },
  {
    name: 'test-guard/a-test-added-and-then-bent-on-the-same-branch',
    gate: ['node', ['scripts/test-guard.mjs']],
    expectEnv: (base) => ({ MIO_BASE_REF: base }),
    expect: /was modified on this branch with no declaration/i,
    plant() {
      const base = sh('git', ['-C', WT, 'rev-parse', 'HEAD']).trim();
      write('src/probe-added-then-bent.spec.ts',
        `import { expect, it } from 'vitest';\n\nit('S1 — probe', () => { expect(compute()).toBe(3); });\n`);
      commit('test: probe added\n');
      write('src/probe-added-then-bent.spec.ts',
        `import { expect, it } from 'vitest';\n\nit('S1 — probe', () => { expect(compute()).toBe(4); });\n`);
      commit('fix: make it pass\n');
      return base;
    },
  },
  {
    name: 'red-check/a-new-test-that-is-green-without-the-code',
    gate: ['node', ['scripts/red-check.mjs']],
    expectEnv: (base) => ({ MIO_BASE_REF: base }),
    expect: /PASSES at the merge-base/i,
    plant() {
      const base = sh('git', ['-C', WT, 'rev-parse', 'HEAD']).trim();
      write('src/probe-vacuous.spec.ts',
        `import { expect, it } from 'vitest';\n\nit('S1 — a vacuous test', () => { expect(2 + 2).toBe(4); });\n`);
      commit('test: a test that needs no implementation\n');
      return base;
    },
  },
  {
    name: 'red-check/a-sibling-spec-is-never-staged-into-the-base-run',
    gate: ['node', ['scripts/red-check.mjs']],
    expectEnv: (base) => ({ MIO_BASE_REF: base }),
    // The planted pair: `vacuous.spec.ts` passes on its own, and `oracle.spec.ts`
    // sits beside it in the same __tests__ directory. If the gate staged the
    // sibling, nothing would change — but if it ever staged it INSTEAD of
    // measuring each file alone, the green file would go unnoticed. The gate must
    // still report the green one.
    expect: /PASSES at the merge-base/i,
    plant() {
      const base = sh('git', ['-C', WT, 'rev-parse', 'HEAD']).trim();
      write('src/platform/probe/__tests__/oracle.spec.ts',
        `import { expect, it } from 'vitest';\n\nit('S1 — oracle', () => { expect(1).toBe(1); });\n`);
      write('src/platform/probe/__tests__/vacuous.spec.ts',
        `import { expect, it } from 'vitest';\n\nit('S2 — vacuous', () => { expect(2 + 2).toBe(4); });\n`);
      commit('test: two specs in one directory\n');
      return base;
    },
  },
  {
    name: 'red-check/a-missing-table-is-crash-red-not-a-missing-environment',
    gate: ['node', ['scripts/red-check.mjs']],
    expectEnv: (base) => ({ MIO_BASE_REF: base }),
    // A test whose setup touches a table the branch adds must come out crash-red.
    // Classifying that as "the environment was missing" fails a correct ticket
    // closed, which is exactly what the first version of the classifier did.
    expectPass: true,
    expect: /crash-red/i,
    plant() {
      const base = sh('git', ['-C', WT, 'rev-parse', 'HEAD']).trim();
      write('src/probe-missing-table.integration.spec.ts',
        `import { beforeAll, expect, it } from 'vitest';\nimport { createTestDb } from './test/db.helper';\n\n` +
        `let sql: Awaited<ReturnType<typeof createTestDb>>;\n` +
        `beforeAll(async () => { sql = await createTestDb('probe-missing'); await sql.sql\`select 1 from probe_absent\`; });\n` +
        `it('S1 — probe', () => { expect(1).toBe(1); });\n`);
      commit('test: a spec whose setup needs a table the branch adds\n');
      return base;
    },
  },
  {
    name: 'red-check/requires-the-tests-phase-to-add-a-test',
    gate: ['node', ['scripts/red-check.mjs', '--require-tests']],
    // Base == HEAD, so the branch adds nothing: the tests phase must not be able
    // to finish without a test. (An earlier version of this probe planted
    // nothing and relied on the branch being empty, which quietly stopped being
    // true the moment a real ticket added tests.)
    expectEnv: (base) => ({ MIO_BASE_REF: base }),
    expect: /adds no test file/i,
    plant() { return sh('git', ['-C', WT, 'rev-parse', 'HEAD']).trim(); },
    skipBaseline: true,
  },
];

// ---------------------------------------------------------------------------
function freshWorktree() {
  rmSync(WT, { recursive: true, force: true });
  trySh('git', ['worktree', 'prune']);
  mkdirSync(dirname(WT), { recursive: true });
  sh('git', ['worktree', 'add', '--detach', WT, 'HEAD'], { stdio: 'ignore' });
  if (!existsSync(join(WT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(WT, 'node_modules'));
  overlayWorkingTree();
  // The probes must measure the gates as they are ABOUT to be committed, not as
  // they were at HEAD — otherwise a gate can only be probed after it is pushed.
  sh('git', ['-C', WT, 'add', '-A'], { stdio: 'ignore' });
  sh('git', ['-C', WT, 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'probe: working tree overlay'], { stdio: 'ignore' });
}

function overlayWorkingTree() {
  const fields = sh('git', ['status', '--porcelain', '-z', '--untracked-files=all']).split('\0');
  const skip = (p) => p.startsWith('.tmp/') || p.startsWith('node_modules/') || p.startsWith('dist/');
  const remove = (p) => rmSync(join(WT, p), { recursive: true, force: true });
  const copy = (p) => {
    const src = join(ROOT, p);
    const dest = join(WT, p);
    if (!existsSync(src)) return remove(p);
    mkdirSync(dirname(dest), { recursive: true });
    if (statSync(src).isDirectory()) cpSync(src, dest, { recursive: true });
    else cpSync(src, dest);
  };
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    // A rename or copy occupies TWO NUL-separated fields: the new path, then the
    // old one. Reading only the first leaves the old file in place, which showed
    // up as a duplicate board card — and as a probe that proved nothing.
    if (code.startsWith('R') || code.startsWith('C')) {
      const old = fields[i + 1];
      i += 1;
      if (old && !skip(old)) remove(old);
      if (!skip(path)) copy(path);
      continue;
    }
    if (skip(path)) continue;
    if (code.includes('D')) remove(path);
    else copy(path);
  }
}

const selected = probes.filter((p) => !filter || p.name.includes(filter));
console.log(`\ngate-probes — ${selected.length} probe(s)\n`);
const failures = [];

for (const probe of selected) {
  freshWorktree();
  const [cmd, args] = probe.gate;

  if (probe.setup) probe.setup();
  if (!probe.skipBaseline) {
    const baseline = run(cmd, args);
    if (!baseline.ok) {
      failures.push(`${probe.name}: BASELINE failed — the gate does not pass on a clean tree, so this probe proves nothing.\n${indent(baseline.out)}`);
      console.log(`✗  ${probe.name}  (baseline)`);
      continue;
    }
  }

  const planted = probe.plant();
  const env = probe.expectEnv ? probe.expectEnv(planted) : {};
  const res = trySh(cmd, args, { cwd: WT, env: { ...process.env, CI: '1', FORCE_COLOR: '0', ...env }, timeout: 300_000 });

  // A few probes assert the opposite: the gate must ACCEPT the planted state, and
  // say the right thing about it. That is how a classifier is kept honest — the
  // bug it guards against is a correct ticket failed closed, not one let through.
  if (probe.expectPass) {
    if (!res.ok) {
      failures.push(`${probe.name}: the gate REJECTED a state it should accept.\n${indent(res.out)}`);
      console.log(`✗  ${probe.name}  (gate went red)`);
    } else if (!probe.expect.test(res.out ?? '')) {
      failures.push(`${probe.name}: the gate passed, but did not say ${probe.expect}.\n${indent(res.out)}`);
      console.log(`✗  ${probe.name}  (wrong verdict)`);
    } else {
      console.log(`✓  ${probe.name}`);
    }
    continue;
  }

  if (res.ok) {
    failures.push(`${probe.name}: the gate PASSED on a planted violation. The gate is not doing its job.\n${indent(res.out)}`);
    console.log(`✗  ${probe.name}  (gate stayed green)`);
  } else if (!probe.expect.test(res.out ?? '')) {
    failures.push(`${probe.name}: the gate failed, but not for the expected reason (wanted ${probe.expect}).\n${indent(res.out)}`);
    console.log(`✗  ${probe.name}  (wrong reason)`);
  } else {
    console.log(`✓  ${probe.name}`);
  }
}

rmSync(WT, { recursive: true, force: true });
trySh('git', ['worktree', 'prune']);

function indent(s) { return (s ?? '').trim().split('\n').slice(-25).map((l) => `      ${l}`).join('\n'); }

console.log('');
if (failures.length) {
  for (const f of failures) console.log(`✗  ${f}\n`);
  console.log(`gate-probes: FAIL — ${failures.length} of ${selected.length} probe(s)`);
  process.exit(1);
}
console.log(
  `gate-probes: PASS — all ${selected.length} probes behaved: each gate goes red on its planted violation ` +
    'and green without one, and the classifier probes accept what they should.',
);
