# Part D — AI-development evidence log

Most of the code in this repository was written by an AI agent (Claude, via Claude Code). This
document is the evidence for that claim and, more usefully, the evidence for what had to be built
around it.

For the tooling, the five things the assignment asks to be shown, and the argument for why this
process rather than another, see [how-ai-was-used.md](how-ai-was-used.md). This document is the
evidence underneath it: what the gates actually caught.

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
| 15 specs with numbered, testable statements (MIO-001…013, MIO-015 and MIO-016; MIO-000 is the pipeline itself and MIO-014 is documentation, so neither has one) | [docs/specs/](../specs/) |

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
| `test-guard` inspected `M` and added-then-bent, and nothing else | A `git rm` of a spec file passed while the gate printed "no test file was modified after it was written", and `pnpm verify` was green because the tests were gone. A rename-with-edit passed both `test-guard` and `red-check` — and git reports it as `R098`, which is the status itself saying the file was modified. Deleting a test is strictly easier than bending one, so the gate was guarding the hardest route and leaving the easy ones open (round-two review R2-B3) |
| Nothing anywhere checked for `.only`, `.skip` or `.todo` | A committed `.only` silences every sibling in its file and a committed `.skip` satisfies `pnpm verify` while asserting nothing. Both are the failure `test-guard` exists for, reached without touching a single assertion. Found by reading the gate set for something it did not cover, which is the only way this one could have been found |
| `red-check`'s "crash-red must be declared" rule was an AGGREGATE | One `assertion-red` file switched it off for every undeclared crash-red sibling. Measured: a deliberately broken implementation plus a file-existence assertion, an all-`it.skip` spec and a `typeof === 'function'` tautology passed `red-check`, passed `test-guard`, and left the suite green (R2-B4). The single-file case had been closed by the first fix round; the composite case was created by closing it |
| `assertion-red` is awarded on the error CLASS alone | So `expect(existsSync('…a file the branch adds…')).toBe(true)` earns the gate's strongest verdict while observing nothing the branch does. The honest-limits block at the top of that file warned about `crash-red` and not about this, which made the strongest verdict the least examined one |
| `red-check` measures added FILES | Every test of the first fix round — the only evidence that two blockers were closed — was added into a spec file that already existed, so none of them ever faced the gate whose purpose is to prove a test is real. They were good tests; the pipeline is what failed to establish it. Now named on every run; TD-0012 is the fix |

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
| **`.env.example` told you to copy it to `.env`, and nothing anywhere read `.env`** — no dotenv, no `--env-file`. So `pnpm db:seed` and `pnpm dev` failed from a clean clone with `Invalid configuration: PLAYER_TOKEN_SECRET`, which is the second step of the documented first run | A clean-clone rehearsal: clone the public repository, `pnpm install`, follow the README | The first thing a reviewer does after installing would have failed while every gate was green — because every gate runs in a checkout that already has an environment, and nothing ever started from zero. Exactly the shape of `pnpm dev` above, which is the lesson this repository had already learned once. `pnpm db:migrate`, `pnpm test` (35 files, 242 tests) and `pnpm smoke` (14 asserted steps) all passed from that same clone, which is why nothing had noticed. The fix is `--env-file-if-exists` on every script that needs configuration, the same load in `vitest.config.mts`, and **the documented first run as a CI step** |
| The fix for that one broke the suite: `process.loadEnvFile` **throws** when the file is absent, and `?.` guards the function being missing, not the file | `pnpm verify`, one minute later | A checkout without a `.env` — the normal case here, CI included — could not load the vitest config at all. The repair of a broken documented path would have broken the measured one, which is the pattern the round-two review found in money code and this is its cheap twin |
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
  crash-red for exactly that reason. The round-two review added the half of this bullet that was
  missing: `assertion-red` proves only that an assertion failed, not that it was about this
  branch, so the gate's strongest verdict is still a verdict about a RUN and never about
  relevance. And it measures added files, so cases added into an existing spec are outside it
  entirely (TD-0012) — which is how every test of the first fix round got in.
- **Two review rounds, and the second one is why this list is longer.** The first review's fixes
  were written by the session that had found the defects, so they had no adversary: round two
  re-measured all 25 of its findings and then attacked the fixes, finding four blockers of which
  two were money defects the fix itself introduced (a stale lease holder refunding an issued
  reward; a recovery asking the operator to grant twice and recording it as a clean success). The
  mechanism that worked is the separation, not the reviewing: the same move — review, fix, review
  the fix with a session that cannot see its own reasoning — is what produced both lists.
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
- **git cannot say WHICH agent made a change.** Every commit here carries the same
  `Co-Authored-By` line and the same committer, so the history distinguishes *agent from human*
  and nothing finer. Which session wrote a given commit is recoverable only from its branch and
  worktree. This stopped being academic: the round-two reviewer reported that the fix session had
  merged to `main` against its brief, having inferred the author from `main` moving while that
  session was working. It had not — the main session merged, at my request — and the reviewer
  corrected itself once told. An inference presented as a measurement is the one failure this
  whole document is about, and it happened in the reporting *about* the pipeline rather than in
  the pipeline.
- **One day.** The gates are real and tested; the product is a vertical slice. Everything in
  [docs/tech-debt.md](../tech-debt.md) is deliberate and written down rather than discovered.
