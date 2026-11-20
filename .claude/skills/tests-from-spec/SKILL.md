---
name: tests-from-spec
description: Write failing tests from a hardened spec BEFORE any implementation exists. Step 2 of the spec-first flow — run it in a FRESH session that has never seen an implementation plan.
---

# tests-from-spec

You write the tests. You do **not** write the implementation, and you must not read or write an
implementation plan in this session — a session that has designed the code writes the test its
design satisfies, which is the failure this phase exists to prevent.

## Procedure

1. Read `docs/specs/MIO-XXX.md` and `AGENTS.md`. Read nothing in `src/modules/<this module>`
   beyond what already exists on the branch.
2. `pnpm spec-gate MIO-XXX` must pass before you start. If a `Q` is open, stop: the answer
   changes the tests.
3. `git mv` the card to `board/2-in-tests/`, update `column:`, commit the move.
4. For every `S`-id, write at least one test whose **name begins with the S-id**:

```ts
it('S4 — a replayed deposit returns the original event id and grants no second entitlement', …)
```

   Place it by cost: `*.spec.ts` for domain and application with fake ports (no I/O);
   `*.integration.spec.ts` for anything that needs Postgres, HTTP or the fake operator.
5. Assert the **observable** thing the spec names: the status code, the stored row, the balance,
   the error body. Never assert on a private method or on a log line.
6. Run the suite. Every new test must fail, and **fail on its assertion**, not on a missing
   import where you can avoid it — write the test against the interface the spec implies, so the
   failure is "expected 409, got 500" rather than "cannot find module". Where the module does not
   exist yet, a crash is acceptable but weaker, and `red-check` will say so.
7. `pnpm red-check --require-tests`. It checks out the merge-base into a clean worktree and runs
   each added file alone. Every file must come out red. A file that comes out **green passes
   without the implementation and therefore tests nothing** — fix it or delete it.
8. Commit: `test(MIO-XXX): failing tests for S1–Sn` with a `Ticket:` trailer. Save the gate output
   to `docs/ai/gate-runs/MIO-XXX-red-check.txt`.

## Rules

- No production code. No stub that makes a test pass. No `it.todo`, no `skip`.
- If an `S` statement cannot be tested as written, that is a **spec defect**: report it, do not
  reinterpret it. Commit `spec-conflict: S<n> — <what is untestable about it>` and stop.
- Fixtures live beside the test file. `red-check` stages only the file under test and fixtures in
  its own directory; a helper placed elsewhere makes the measurement meaningless.
- Integration tests get a database per file. Clean on the way in, not only on the way out.
