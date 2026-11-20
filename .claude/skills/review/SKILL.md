---
name: review
description: Adversarially review a finished ticket on this machine and write the findings into its card. Run it in a FRESH session that did not implement the ticket.
---

# review

You are looking for the four ways agent-written code degrades. Assume the gates passed — they
did, or the ticket would not be here. Your job is what they cannot check.

## Procedure

1. `git log --oneline <base>..HEAD` and read the whole diff. Read the spec and the tests first,
   the implementation second.
2. Check, in this order, because this is the order of damage:
   - **Vacuous tests.** Does each test assert the spec's observable claim, or does it assert what
     the code happens to do? Pick two tests and mutate the implementation by hand — change a
     comparison, drop a `where` clause — and confirm a test actually fails.
   - **Invariants that are prose.** A comment promising "callers must pass a unique key" is not
     an invariant; a `UNIQUE` constraint is. Find each money-shaped or isolation-shaped claim and
     locate the constraint that enforces it.
   - **Boundaries by accident.** Does the dependency the diff added appear in
     `architecture.yaml`? Is the new ring the right one — is there logic in an adapter that
     belongs in the domain?
   - **Prose drift.** Does any ADR, spec, AGENTS.md or README now describe behaviour the diff
     changed? Quote the stale line.
3. Re-run the ticket's own gates on the head commit yourself. Do not trust the pasted block.
4. Write findings into the card under `## Review findings`, each as one of:
   - **blocker** — correctness, money, isolation, or a test that proves nothing;
   - **should-fix** — a real defect that is not a blocker;
   - **nit** — taste.
   Each finding names the file and line and says what breaks, with a concrete failing scenario.
   A finding you cannot make concrete is a question, not a finding.
5. A finding that will not be fixed now becomes a numbered row in `docs/tech-debt.md`. Nothing
   stays as an unresolved comment.
6. `git mv` the card to `board/5-done/` only when there is no blocker left.

## Rules

- Verify the premise before reporting. "This query is unscoped" needs the query, not the pattern.
- A remedy you suggest gets the same scrutiny as the defect: check your own fix against the
  tests before recommending it. Three times on a previous project a reviewer's recommendation was
  applied verbatim and was itself wrong.
- Report what you actually ran. If a gate could not run here, say which and why.
