# MIO Games — gamification vertical slice

A working slice of a multi-tenant gamification platform for casino operators. An operator's
deposit event becomes a wheel spin; the spin becomes coins in a ledger; the coins buy a reward
from a bonus store; the reward is issued back through the operator's own API — with the duplicate
deliveries, concurrent requests, timeouts and failures a money-shaped system has to survive.

Two simulated operators with **genuinely different schemas on both sides** drive the same
gamification logic. A third was onboarded as a rehearsal, to measure what that claim costs: six
files, none of them in the core ([scaling.md §2](docs/scaling.md)).

The process around this — the specs, the board, the ten gates — is one card of sixteen; the other
fifteen are the product. It is a distillation, not an invention for this exercise — a
working method of my own, already running on a live product
([Part D](docs/ai/how-ai-was-used.md)).

```bash
nvm use && pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm smoke          # all eight Part B steps, both operators, asserted
```

`pnpm smoke` output from this repository is in
[docs/ai/gate-runs/final-smoke.txt](docs/ai/gate-runs/final-smoke.txt). It captures the sample
requests and responses itself — `pnpm smoke:samples` writes them, while plain `pnpm smoke` (the
one `verify` runs) asserts without touching a tracked file.

## Where each part of the assignment is answered

| | |
| --- | --- |
| **A — architecture** | [docs/architecture/README.md](docs/architecture/README.md) · [diagrams](docs/architecture/diagram.md) · [7 ADRs](docs/decisions/) · [the machine-checked model](docs/architecture/architecture.yaml) |
| **B — the working prototype** | `pnpm smoke` — 14 asserted steps across both operators · [captured samples](docs/samples/part-b-flow.http.md), refreshed with `pnpm smoke:samples` |
| **C — reliability & security** | [docs/reliability.md](docs/reliability.md) — every case, its mechanism, and the test that proves it |
| **D — AI-native development** | **[how AI was used, and why this process](docs/ai/how-ai-was-used.md)** — start here · [what the gates caught](docs/ai/evidence-log.md) · [which decisions were mine](docs/ai/human-decisions.md) · [AGENTS.md](AGENTS.md) · [the phase skills](.claude/skills/) · [the pipeline's mechanics](docs/process.md) · [what it still cannot catch, and what the answer is](docs/known-gaps.md) · [raw gate runs](docs/ai/gate-runs/) |
| **E — scaling the product** | [docs/scaling.md](docs/scaling.md) · [the first 90 days and the team](docs/plan/90-days.md) |
| **Deliverables** | setup above · [assumptions](docs/assumptions.md) · [tech debt, deliberate](docs/tech-debt.md) · [known gaps with designed answers](docs/known-gaps.md) · [observability](docs/observability.md) · [the board](board/) |

## What to look at first

**In two minutes.** `pnpm smoke`. It drives all eight Part B steps for both operators and asserts
every one — and at the spin it takes the seed the API revealed, recomputes
`weightedPick(slices, uniform01(seed, spinId))` with its own implementation, and asserts the slice
matches. That is the fairness claim checked rather than described.

**In ten.** Three documents, in this order:

1. **[docs/architecture/README.md](docs/architecture/README.md) §2 and §6** — the six modules,
   what each must *not* own, and which of them should become services, in what order, on what
   trigger. §6 is the answer to "modules or services"; it names the trigger for each extraction
   and the one split I would refuse.
2. **[docs/review/](docs/review/)** — two independent adversarial reviews, run in separate
   sessions against this code. The first found three blockers; the second found **two money
   defects that the first round's fixes had introduced**, with a real `SIGKILL` across two worker
   containers to prove one of them. Both are merged with the findings, not summarised.
3. **[docs/ai/evidence-log.md](docs/ai/evidence-log.md)** — what the gates caught, and what each
   would have cost. Read its *Honest limits* section: `red-check` proves a test fails without the
   implementation, not that it asserts the right thing, and the document says so before a reviewer
   can.

**If you want to see the process rather than read about it:** any card in
[board/5-done/](board/5-done/) carries its spec, its red tests, its implementation, its review
findings and its gate output, in that order.

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
