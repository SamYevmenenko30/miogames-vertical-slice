---
name: spec-harden
description: Turn a board card into a testable spec (docs/specs/MIO-XXX.md) before any test or code exists. Step 1 of the spec-first flow — run it in a FRESH session, and run it again when a later phase sends a defect back.
---

# spec-harden

You are turning a card into a **spec that a test can be written from without guessing**. You are
not designing the implementation, and you must not write code in this session.

## Procedure

1. Read the card in `board/0-backlog/` (or wherever it is), `AGENTS.md`,
   `docs/architecture/README.md`, and the ADRs the card's scope touches. Read the specs of the
   cards in `depends_on` — their `S`-ids are the contract you build on.
2. `git mv` the card into `board/1-in-spec/` and set `column: 1-in-spec` in its front-matter.
   Both, or `pnpm board:check` fails. Commit that move on its own.
3. Write `docs/specs/MIO-XXX.md`:

```markdown
# SPEC: MIO-XXX — <title>

Card: board/1-in-spec/MIO-XXX-<slug>.md · Revision 1 · Author: agent (Claude), <date>

## Context
Why this exists, in three sentences. Link the ADR that governs it.

## Decisions taken here
What this spec settles that the ticket did not, and who settled it.

## Behaviour spec
- **S1 — <one-line claim>.** The observable behaviour, in enough detail that a test can
  assert it without inventing a value. Name the endpoint, the state, the error code.
- **S2 — …**

## Open questions
- **Q1 — <the question>?** <why it cannot be answered from the ticket> → **Answered**
  (<who>, <YYYY-MM-DD>): <the answer>

## Out of scope
## Tests this spec expects
A list: which S-id becomes a unit test, which needs Postgres, which needs the fake operator.
```

4. Each `S` statement must be **individually testable** and **observable**. "The ledger is
   correct" is not a statement. "A debit that would take the balance below zero fails with 409
   and leaves the balance unchanged" is.
5. Write down every question you had to guess the answer to. This is the single most valuable
   thing you produce: a question you quietly answered is a product decision buried in an `if`.
   Ask the human. Do not answer a `Q` yourself unless it is a pure matter of code taste — and
   then say so in the answer.
6. Run `pnpm spec-gate MIO-XXX`. While a `Q` is unanswered it fails, by design. Report the open
   questions to the human and stop.
7. Once answered, record each answer with who decided and the date, re-run the gate, commit:
   `spec(MIO-XXX): <subject>` with a `Ticket: MIO-XXX` trailer.

## Rules

- No implementation, no file in `src/`, no test. If you find yourself writing "the repository
  method should…", you have left the spec.
- If a dependency's spec contradicts this one, say so in `## Context` and raise it as a `Q`.
- A revision of an existing spec (sent back from a later phase) bumps the revision line, keeps
  the old statements' numbers stable, and adds new ones at the end. Renumbering invalidates every
  test name that references an `S`-id.
