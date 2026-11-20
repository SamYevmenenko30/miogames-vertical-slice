# MIO Games — gamification vertical slice

A working slice of a multi-tenant gamification platform for casino operators: an operator's
deposit event becomes a wheel spin, the spin becomes coins in a ledger, the coins buy a reward
from a bonus store, and the reward is issued back through the operator's own API — with the
duplicate deliveries, concurrent requests, timeouts and failures that a money-shaped system has
to survive.

Built as a test assignment. The interesting part is not the feature list; it is **how it was
built**: spec-first, with machine-checked gates around an AI agent that wrote most of the code.

| | |
| --- | --- |
| **Part A — architecture** | [docs/architecture/README.md](docs/architecture/README.md) · [diagrams](docs/architecture/diagram.md) · [7 ADRs](docs/decisions/) |
| **Part B — the working flow** | [`pnpm smoke`](#run-it) runs all eight steps · [samples](docs/samples/) |
| **Part C — reliability & security** | [docs/reliability.md](docs/reliability.md) — one test per case, named |
| **Part D — AI-native development** | [AGENTS.md](AGENTS.md) · [docs/process.md](docs/process.md) · [evidence log](docs/ai/evidence-log.md) · [gate runs](docs/ai/gate-runs/) |
| **Part E — scaling** | [docs/scaling.md](docs/scaling.md) · [first 90 days](docs/plan/90-days.md) |
| **Board** | [board/](board/) — the Jira board as folders; `pnpm board` prints it |

## Run it

```bash
nvm use && pnpm install
docker compose up -d        # postgres :5440 · api :3000 · worker · casino mock :3010
pnpm db:migrate && pnpm db:seed
pnpm smoke                  # drives the whole flow for both operators, printing each step
```

Tests: `pnpm test` (needs Postgres) or `pnpm test:unit` (no I/O, runs anywhere).
Everything at once, as before a push: `pnpm verify`.

## What to look at first

1. [docs/architecture/README.md](docs/architecture/README.md) §2 and §6 — the six modules, and
   which of them should become services, in what order, and on what trigger.
2. [ADR-0007](docs/decisions/ADR-0007-spec-first-pipeline-for-ai-agents.md) — the four ways
   AI-written code degrades and the gate that catches each.
3. `pnpm gate-probes` — plants a violation of every gate and proves the gate goes red. It found
   three dead gates while this repository was being built; they are in the
   [evidence log](docs/ai/evidence-log.md).
4. Any card in [board/5-done/](board/5-done/) — spec, red tests, implementation, review, in that
   order, with the gate output.

## Assumptions

Written out in full in [docs/assumptions.md](docs/assumptions.md). The short list: coins are
per-tenant and non-transferable; an operator is a tenant; the operator owns the player's identity
and real wallet; reward issuance is at-least-once with an idempotency contract on the operator's
side; nothing here is real money, but everything here is treated as if it were.

## Not built, on purpose

No frontend, no real casino integration (two simulated operators instead), no production
infrastructure, no metrics backend. Said plainly, with reasons, in
[docs/architecture/README.md §7](docs/architecture/README.md) — and the priorities behind those
choices are the answer to the last line of the assignment.
