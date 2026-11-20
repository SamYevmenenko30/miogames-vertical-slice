# ADR-0007 — A spec-first pipeline with machine-checked gates for AI-written code

Status: Accepted · Date: 2026-11-20

## Context

Part D asks how AI was used and how its output was verified. Most of the code in this repository
was written by an AI agent (Claude), which changes what "verified" has to mean. Reading a diff
proves that the code looks reasonable. It does not prove that the tests test anything, that the
architecture survived, or that the prose still matches the behaviour — and those are precisely
the three things that degrade when an agent writes fast.

The failure modes are specific and observable:

- a test that passes with or without the implementation (an agent will happily write both);
- a test edited until it passes, instead of code fixed until the test passes;
- a plausible-looking shortcut that quietly crosses an architectural boundary;
- documentation that describes the behaviour the agent *intended* two commits ago.

## Decision

Work moves through three phases, each in a fresh agent session, with a gate between them:

```
ticket → spec-harden → tests-from-spec → implement-to-green → review
            │               │                  │                │
         spec-gate       red-check          verify           review gate
```

- **spec-harden** turns a ticket into `docs/specs/MIO-XXX.md` with numbered, individually
  testable statements (`S1`, `S2`, …) and an explicit `## Open questions` section.
  `pnpm spec-gate` refuses to let the ticket advance while a question is unanswered — an
  unanswered question is where an agent invents a decision.
- **tests-from-spec** writes failing tests, each referencing an `S`-id, in a session that has
  never seen an implementation plan. `pnpm red-check` then proves mechanically that **every test
  file the branch adds fails at the merge-base**, each file on its own, in a clean worktree. A
  new test that is already green guards nothing.
- **implement-to-green** writes code until the suite passes. Spec tests are read-only in this
  phase; a disagreement with the spec is a `spec-conflict:` commit that sends the spec back for
  revision, never a quiet test edit. `pnpm test-guard` enforces that.
- **review** runs the whole gate set plus the architecture and board checks, and the findings are
  recorded in the ticket's card.

And the gates themselves are tested: `pnpm gate-probes` plants a violation of each rule and
asserts the gate goes red. A gate nobody has ever seen fail is a gate that may not work.

## Consequences

- The verification story is mechanical and reproducible, not a claim: `docs/ai/gate-runs/`
  holds the actual gate output per ticket, including the run where a gate caught something.
- The cost is real: three sessions and a spec per ticket is slower per ticket than asking an
  agent for a feature. It is faster per *correct* ticket, and it is the only version of this
  that scales past one person's attention span.
- `red-check` has honest limits, written in the script's own header: a test that crashes at the
  base because it imports code the branch adds counts as red, which proves less than an
  assertion failure. The gate reports which kind it got.
- The board lives in the repository (`board/`), one file per card, column = folder. Moving a card
  is a `git mv`, so the history of the work is the history of the repo, and `pnpm board:check`
  can enforce a work-in-progress limit of one.

## Alternatives rejected

**Code review alone.** It is the control most teams rely on and it does not catch a vacuous
test, because a vacuous test reads exactly like a real one.

**Coverage thresholds.** They measure that a line ran, which an agent can satisfy without
asserting anything. `red-check` measures that a test *fails without the code*, which is the
property actually wanted.

**A CI-only gate set.** CI minutes are slow feedback for a solo pipeline, and a gate the author
cannot run locally gets worked around. The same gates run in both places; CI is the arbiter, the
local run is the loop.
