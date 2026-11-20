# MIO Games slice — agent guide

Canonical instructions for any AI agent (and any human) working in this repository. Read this
before changing anything. It is also one of the assignment's Part D deliverables: this is the
real file the agent followed, not a sanitised copy.

## Ground rules

1. **Spec first, test second, code third.** Nothing is implemented before
   `docs/specs/<TICKET>.md` exists and its open questions are answered, and before failing tests
   reference its `S`-ids. The three phases run in **separate sessions**; see
   [docs/process.md](docs/process.md).
2. **A test you cannot see fail is not a test.** `pnpm red-check` must prove every test file the
   branch adds fails at the merge-base. If a test passes without the implementation, delete it or
   fix it — do not explain it.
3. **Spec tests are read-only while implementing.** If the spec is wrong, stop and commit the
   disagreement as `spec-conflict: <S-id> — <what the spec gets wrong>`. Never edit a spec test
   to make it pass.
4. **Boundaries are law.** `src/modules/<m>/domain` imports nothing but its own domain and
   `src/contracts`. `application` never imports adapters. A module reaches another module only
   through `index.ts`. The linter fails the build; do not route around it with a re-export.
5. **One transaction per use-case, opened in the application layer.** Events only through the
   outbox. A synchronous call into another module is allowed only when its result is needed for
   *your* transaction to be correct. Litmus test: "would this request still be correct if the
   other part ran five seconds later?" — yes means event.
6. **Every money-moving write names an idempotency key.** If you cannot name one, the operation
   is not safely retryable and the design is wrong.
7. **Every tenant-owned query is scoped.** Use `scoped(table)`; never build a `where` on a
   tenant-owned table by hand. New module ⇒ new tenant-isolation test.
8. **No invented data, ever.** A stub returns an honest empty state and says "not implemented".
   A plausible-looking fake balance on a real endpoint is a defect, not a placeholder.
9. **A comment may only state an invariant this module enforces.** A promise about another
   module's behaviour either moves there or becomes a line in `docs/tech-debt.md`.
10. **Update the prose you invalidate, in the same commit.** If behaviour changes, the ADR,
    the spec, the module AGENTS.md and the architecture model change with it.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm verify` | lint + typecheck + unit + integration + build + arch-check + board:check. The pre-push check. |
| `pnpm spec-gate MIO-003` | The spec exists, has `S`-ids, has no unanswered open question, and has a card. |
| `pnpm red-check` | Every test file added on this branch fails at the merge-base, each on its own, in a clean worktree. |
| `pnpm test-guard` | No pre-existing spec test was modified without a `spec-conflict:` commit. |
| `pnpm arch-check` | The source tree matches `docs/architecture/architecture.yaml`. |
| `pnpm board` / `pnpm board:check` | Print the board / enforce card ↔ folder, WIP limit, ticket trailers. |
| `pnpm gate-probes` | Plant a violation of every gate and assert the gate goes red. |
| `pnpm review:request MIO-003` | Run the whole set and print the block that goes in the card's review section. |
| `pnpm dev` / `pnpm dev:worker` / `pnpm dev:casino` | The three processes, with reload. |
| `docker compose up -d` | Postgres + api + worker + the two simulated operators. |
| `pnpm db:migrate` / `pnpm db:seed` | Migrations are applied **explicitly, never at boot**. Seed creates two tenants. |

Ports: api `:3000` · casino mock `:3010` · Postgres `:5440` (chosen to avoid colliding with a
local 5432/5433).

## Repository map

```
src/
  main.api.ts            composition root #1 — HTTP
  main.worker.ts         composition root #2 — outbox relay, consumers, retries
  contracts/             Zod event + API schemas shared by modules (no logic)
  platform/              config · db · events · http · observability · crypto · clock · audit
  modules/<name>/
    domain/              pure: entities, value objects, rules. No Nest, no Drizzle, no clock.
    application/         use-cases, transactions, ports (interfaces)
    adapters/in/         HTTP controllers, event consumers
    adapters/out/        repositories, HTTP clients
    index.ts             the facade — the ONLY thing other modules may import
    <name>.module.ts     Nest wiring, the only place that sees all three rings
    AGENTS.md            this module's invariants and traps
  mocks/casino-platform/ two simulated operators, different dialects, injectable failures
board/<column>/          the Jira board, one file per card; column = folder
docs/
  specs/MIO-XXX.md       the hardened specs (S-ids)
  architecture/          Part A: README, diagrams, architecture.yaml (machine-checked)
  decisions/ADR-XXXX     the decisions, with alternatives rejected
  ai/                    Part D: evidence log, human-vs-agent decisions, gate runs
  plan/90-days.md        Part E
  samples/               sample requests and responses
scripts/                 the gates
```

## Conventions

- **Events**: `module.entity.verb`, Zod schema in `src/contracts/events`, declared in
  `architecture.yaml`. A consumer is idempotent by construction (extend the base class).
- **Errors**: RFC 9457 problem+json. Another tenant's resource is `404`, never `403`.
- **HTTP**: `GET` never writes. `POST /v1/redemptions` requires `Idempotency-Key`.
- **Money**: `Money` = minor units + currency. `Coins` = integer. Never a float, anywhere.
- **Time**: inject `Clock`. `Date.now()` in the domain is a lint-adjacent review finding.
- **Config**: `src/platform/config` only. `process.env` elsewhere is a lint error.
- **Tests**: `*.spec.ts` = unit (no I/O). `*.integration.spec.ts` = real Postgres + HTTP. Every
  test's name starts with the `S`-id it proves, so a reviewer can map spec → test by grep.
- **Commits**: `type(scope): subject`, and a `Ticket: MIO-XXX` trailer on everything that belongs
  to a card. Agent-written commits keep their `Co-Authored-By` trailer — the AI evidence log is
  built from it.

## Traps found the hard way in this repository

- `typescript-eslint` refuses to load against TypeScript 7, which takes the boundary gate offline
  *silently* (lint exits non-zero with a loader error, which is easy to mistake for a config
  problem). TypeScript is pinned to 5.9 on purpose.
- `@nestjs/testing` resolves independently of `@nestjs/core`; a mismatched major gives
  `Cannot find module '@nestjs/common/internal'`. Pin them together.
- `red-check` borrows `node_modules` from the current tree, so a test that reaches outside its
  own worktree can contaminate the measurement. Keep test fixtures inside the test file's own
  directory.
- Integration tests get a database per test file. Do not share a schema between files and do not
  clean up in `afterEach` only — clean on the way **in**, because the previous file's crash is
  not your file's problem to inherit.
