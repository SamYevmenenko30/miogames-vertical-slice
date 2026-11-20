# Part D — AI-development evidence log

Most of the code in this repository was written by an AI agent (Claude, via Claude Code). This
document is the evidence for that claim and, more usefully, the evidence for what had to be built
around it.

The short version: **writing the code was the easy half.** The agent is fast, fluent, and exactly
as fluent when it is wrong. What made the output trustworthy was a set of gates that could fail —
and the single most useful thing in this repository is that the gates themselves were tested, and
six of them — the boundary lint, `spec-gate`, `arch-check`, `red-check`, `test-guard` and the
board probes — were dead or wrong on the first run.

## How it was built

Three phases per ticket, each in a fresh agent session, with a gate between them:

```
ticket → spec-harden → tests-from-spec → implement-to-green → review
            │               │                  │                │
         spec-gate       red-check          verify           review:request
```

The artefacts are all in the repository, not described in it:

| Artefact | Where |
| --- | --- |
| The agent instructions actually followed | [AGENTS.md](../../AGENTS.md), and one per module |
| The phase skills the agent was run with | [.claude/skills/](../../.claude/skills/) — `spec-harden`, `tests-from-spec`, `implement-to-green`, `review` |
| The process, including its honest limits | [docs/process.md](../process.md), [ADR-0007](../decisions/ADR-0007-spec-first-pipeline-for-ai-agents.md) |
| The board, as folders, moved with `git mv` | [board/](../../board/) — each card carries its phase log and its review findings |
| The gates | [scripts/](../../scripts/) |
| Raw gate output | [gate-runs/](gate-runs/) |
| 13 specs with numbered, testable statements (MIO-001…013; MIO-000 is the pipeline itself and MIO-014 is documentation, so neither has one) | [docs/specs/](../specs/) |

`git log` is the primary evidence: every ticket that implements behaviour has a `spec(...)`, a
`test(...)` and a `feat(...)` commit in that order, each with a `Ticket:` trailer, and
agent-written commits keep their `Co-Authored-By` line. Three tickets do not fit the shape, and
should not be read as if they did: **MIO-000** built the pipeline itself and has no spec or test
phase, **MIO-013** added the smoke run whose assertions live in `scripts/smoke.ts` rather than in
a `test(...)` commit, and **MIO-014** is documentation only.

## What the gates caught

This is the part worth reading. Each row is a real defect, found by a machine, with what it would
have cost if it had shipped. None of them would have been caught by reading the diff — several
were *in* the things that read the diff.

### In the gates themselves (found by `pnpm gate-probes`, first run)

| What was wrong | Consequence if unnoticed |
| --- | --- |
| `boundaries/elements` used file patterns, which v7 classifies as **nothing** | The hexagonal boundary gate was enforcing nothing at all, while lint passed. Every architectural claim in this repository would have been decoration. The plugin's warning about it reads like a style note |
| No TypeScript resolver for the boundary plugin | Every relative import resolved to "unknown", so every policy matched nothing — the same dead gate from a second direction |
| `export … from` was not a dependency node | A module facade could re-export an adapter, turning its public surface into its implementation |
| `spec-gate` used `\Z`, which JavaScript's regex does not have | It could not see the **last** section of a file, nor the **last** open question. A spec with exactly one unanswered question passed the gate silently — and unanswered questions are the whole point of that gate |
| `arch-check` matched `modules/<name>` in the import string | It missed every *relative* cross-module import, which is all of them |
| The probe harness dropped the old path of a renamed file | A probe's baseline failed for a reason that had nothing to do with its gate: the harness could manufacture its own verdict |
| Board probes named cards by path | They broke silently when the cards moved to another column — a probe that cannot run is a gate that is no longer probed |
| `red-check` staged sibling spec files as "support" | A sibling spec in the base worktree can manufacture the verdict of the file being measured |
| `red-check` reported **assertion-red** for runs that never reached an assertion | vitest prints the failing test's code frame, which contains `expect(...).toBe(...)`, so the classifier matched the source rather than the failure. The gate was claiming a stronger proof than the run earned |
| `red-check` classified "relation does not exist" as a missing environment | It failed a correct ticket closed, which is the way a gate loses a team's trust |
| `spec-gate` ignored a bullet that did not parse as a question (`- **S/Q1 — …**`) | That exact typo shipped in a real spec, and nothing checked whether the question was answered |
| `test-guard` could not see a test added and then bent **within the same branch** | `git diff base..HEAD` calls that file merely "added". It is the common case when one branch carries all three phases, which is the shape this pipeline uses |
| `spec-gate` and `board:check` disagreed about a spec waiver | `verify` contradicted itself, which teaches people to ignore whichever gate is noisier |
| A relative markdown link in the 90-day plan pointed at a file that is one directory up | Found by writing the `docs-links` gate at the end of the work, which found it in a document written minutes earlier. These documents cross-reference heavily, so the links rot exactly as fast as the prose |

### In the product (found by the gates, not by review)

| What was wrong | Which gate | Consequence if unnoticed |
| --- | --- | --- |
| `identity` stored only a **digest** of the operator's webhook secret — correct for a password, impossible for HMAC verification | Found by building the consumer (MIO-004) | Authentication as specified could not be implemented. Neither ticket's own tests could have caught it: the defect lived in the relationship between two cards |
| The operator-leak scan was vacuous **three** ways: it searched the git index rather than the working tree; it asserted only an absence (green at the merge-base, so it proved nothing); and its regex used `\b`, which `git grep -E` does not implement, so it matched **nothing at all** | `red-check`, then an added presence assertion | The claim that makes operator onboarding cheap — that no operator's name leaks out of `integration` — was unguarded while appearing guarded |
| The reward adapters were placed in `rewards` instead of `integration` | The leak scan **and** the boundary lint, from opposite ends | Operator names in a second module; the integration layer's single-point-of-change property quietly lost |
| The retry schedule was written on the injected clock and read against the **database** clock | `issuance.integration.spec.ts` | One drain performed two attempts, and three on a slower machine. This is the shape of a flaky retry test in every project that has one |
| `ON CONFLICT DO UPDATE` is an UPDATE, and the ledger's append-only trigger refuses one | The ledger suite, immediately | The idempotency idiom copied from another table could not work on this one |
| `import type` on an injectable erases the metadata Nest resolves constructors by | Eight suites failed to collect | The error names no parameter and reads like a missing provider |
| The event consumers entered the tenant scope **after** opening the transaction, so the database never learned the tenant | Row-level security, on the day it was added | Every query was correctly scoped at the application level, so nothing failed — until the day someone relied on the database half of the isolation guarantee |
| `current_setting('app.tenant_id', true)` returns the **empty string**, not NULL, once touched on a connection | The suite, on a pooled connection | Policies written against NULL alone refuse everything from the *second* request onwards. It presents as "the first request works and the rest answer 401" |
| **`pnpm dev` had never worked**: esbuild does not emit decorator metadata, so Nest resolved every controller's first parameter as `undefined` | Running it, during MIO-011 | The demo path was broken while the measured path was green. This is why `pnpm smoke` now runs in `verify` and in CI |
| A test that would have passed for the wrong reason: advancing the clock past an entitlement's expiry also expires the player token | Reading the failure instead of the assertion | With a looser expectation it would have gone green while proving nothing about entitlement expiry |
| Twice: an error message that did not match the regex a test greps for — "timed out" against `/timeout/`, "currencies" against `/currency/` | The suite | Cheap, but worth recording twice: when a test greps a message, the message is part of the contract |

## Where the AI was used, and where it was not

**The agent wrote:** essentially all of the code and the tests, every Drizzle schema, both
operator dialects and the simulated operators, the retry and backoff mechanics, the gate scripts,
and the first draft of every document here — including this one.

**I decided:** the module boundaries and what must never be split; which invariants become
database constraints rather than application checks; commit–reveal for the draw; `404` not `403`;
that the gates would be probed; what is deliberately not built. And every question in
[human-decisions.md](human-decisions.md), each of which the agent would have answered
defensibly and wrongly for the business.

**How I verified it:** the gates above, re-run on every ticket. Plus the one thing no gate does —
reading each spec's open questions and answering them myself.

The raw output was **kept for six of them** — MIO-001, 002, 003, 004, 007 and 008, in
[gate-runs/](gate-runs/), alongside the final `gate-probes` and `smoke` runs. It was not kept for
MIO-005, 006, 009, 010, 011, 012, 013 or 014, and those branches were merged and deleted, so
those verdicts are no longer recoverable by anyone. That gap covers the bonus store, reward
issuance and tenant isolation — the three tickets whose evidence a reviewer would most want.

## Honest limits of this evidence

- **`red-check` proves a test fails without the implementation, not that it asserts the right
  thing.** A test that crashes at the merge-base because the module does not exist yet counts as
  red; the gate labels it `crash-red` and says it proves less. Most of the early tickets are
  crash-red for exactly that reason.
- **No branch audit.** The larger pipeline this is modelled on has a gate that reads a branch's
  prose against its diff. It is not here, and it would have caught one thing it should have: two
  module `AGENTS.md` files contradicting each other about an idempotency idiom (MIO-008). I fixed
  that by noticing it, which is precisely the mechanism this project distrusts.
- **The review phase was run by the same person who implemented**, in a separate session with the
  review skill. That is weaker than an independent reviewer and the skill says so.
- **The last gate was written at the end**, after noticing that nothing checked the documents'
  cross-references — and it failed immediately on a link written minutes earlier. That is the
  pattern this whole project is about, and it kept being true right up to the last commit: the
  defect was not in the code anyone was reviewing.
- **One day.** The gates are real and tested; the product is a vertical slice. Everything in
  [docs/tech-debt.md](../tech-debt.md) is deliberate and written down rather than discovered.
