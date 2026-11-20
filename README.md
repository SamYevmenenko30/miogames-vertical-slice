# MIO Games — gamification vertical slice

A working slice of a multi-tenant gamification platform for casino operators. An operator's
deposit event becomes a wheel spin; the spin becomes coins in a ledger; the coins buy a reward
from a bonus store; the reward is issued back through the operator's own API — with the duplicate
deliveries, concurrent requests, timeouts and failures a money-shaped system has to survive.

Two simulated operators with **genuinely different schemas on both sides** drive the same
gamification logic.

```bash
nvm use && pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm smoke          # all eight Part B steps, both operators, asserted
```

`pnpm smoke` output from this repository is in
[docs/ai/gate-runs/final-smoke.txt](docs/ai/gate-runs/final-smoke.txt), and it writes the sample
requests and responses itself.

## Where each part of the assignment is answered

| | |
| --- | --- |
| **A — architecture** | [docs/architecture/README.md](docs/architecture/README.md) · [diagrams](docs/architecture/diagram.md) · [7 ADRs](docs/decisions/) · [the machine-checked model](docs/architecture/architecture.yaml) |
| **B — the working prototype** | `pnpm smoke` — 14 asserted steps across both operators · [captured samples](docs/samples/part-b-flow.http.md) |
| **C — reliability & security** | [docs/reliability.md](docs/reliability.md) — every case, its mechanism, and the test that proves it |
| **D — AI-native development** | [docs/ai/evidence-log.md](docs/ai/evidence-log.md) · [which decisions were mine](docs/ai/human-decisions.md) · [AGENTS.md](AGENTS.md) · [the phase skills](.claude/skills/) · [docs/process.md](docs/process.md) · [raw gate runs](docs/ai/gate-runs/) |
| **E — scaling the product** | [docs/scaling.md](docs/scaling.md) · [the first 90 days and the team](docs/plan/90-days.md) |
| **Deliverables** | setup above · [assumptions](docs/assumptions.md) · [tech debt, deliberate](docs/tech-debt.md) · [observability](docs/observability.md) · [the board](board/) |

## What to look at first

If you have ten minutes:

1. **[docs/architecture/README.md](docs/architecture/README.md) §2 and §6** — the six modules,
   what each must *not* own, and which of them should become services, in what order, on what
   trigger.
2. **[docs/ai/evidence-log.md](docs/ai/evidence-log.md)** — the gates found four dead gates on
   their first run, and a dozen real defects after that. The table of what each would have cost
   is the most honest thing in this repository.
3. **`pnpm smoke`** — it recomputes the spin outcome from the seed the API revealed, with its own
   implementation, and asserts the slice matches. The fairness claim checked rather than described.
4. **Any card in [board/5-done/](board/5-done/)** — spec, red tests, implementation, review, in
   that order, with the gate output and the findings.

## How it was built

Spec-first, three phases per ticket in separate agent sessions, with ten gates between them —
including `red-check` (every added test must fail at the merge-base, each file alone, in a clean
worktree) and `gate-probes` (plant a violation of every rule and require the gate to go red for
the right reason). The board is folders in [board/](board/); moving a card is a `git mv`, so the
history of the work is the history of the repository.

```bash
pnpm verify        # lint (hexagonal boundaries) · typecheck · arch-check · board · spec-gate
                   # · test-guard · 221 tests · build · smoke
pnpm gate-probes   # 23 probes: do the gates actually bite?
pnpm board         # print the board
```

Ports: api `:3000` · worker health `:3002` · casino mock `:3010` · Postgres `:5440`.

## Stack, and why

TypeScript with NestJS (dependency injection is what makes a port substitutable in a test without
a mocking framework), Drizzle over Postgres (queries are explicit and the tenant filter is visible
at every call site), Postgres for *everything* including the queue — one `BEGIN` covers "coins
credited" and "event emitted", which is why there is no lost-reward class of bug here. Reasoned
through in [docs/architecture/README.md §5](docs/architecture/README.md) and the ADRs.

## Not built, on purpose

No frontend, no real casino integrations, no production infrastructure, no metrics backend. Said
plainly with reasons in [docs/assumptions.md](docs/assumptions.md) and
[§7 of the architecture](docs/architecture/README.md); the priorities behind those choices are in
[docs/plan/90-days.md](docs/plan/90-days.md).
