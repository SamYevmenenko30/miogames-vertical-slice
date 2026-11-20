---
name: implement-to-green
description: Implement until the spec tests pass. Step 3 of the spec-first flow — run it in a FRESH session, after tests-from-spec has committed red tests.
---

# implement-to-green

The tests are the specification now. Write code until they pass. **The spec tests are
read-only.**

## Procedure

1. Read `docs/specs/MIO-XXX.md`, the failing tests, `AGENTS.md`, and the ADRs the card names.
2. `git mv` the card to `board/3-in-progress/`, update `column:`, commit. `pnpm board:check`
   enforces a WIP limit of one — if another card is in progress, finish or move it first.
3. Implement, inside the hexagon:
   - pure rules in `domain/` — no Nest, no Drizzle, no `Date.now()`;
   - use-cases and the transaction boundary in `application/`;
   - Drizzle, HTTP clients and controllers in `adapters/`;
   - the module's public surface in `index.ts`, and nothing else at the module root.
4. Re-run the failing tests as you go, then `pnpm verify`.
5. Declare the architecture you added: new cross-module dependency, event or module goes into
   `docs/architecture/architecture.yaml`; `pnpm arch-check` fails otherwise. Write the module's
   `AGENTS.md` invariants as you discover them.
6. Update the prose you invalidated — the ADR, the spec, `docs/tech-debt.md` — in the same
   commit as the behaviour change.
7. `pnpm review:request MIO-XXX`, paste its block into the card, `git mv` to `board/4-in-review/`.

## Rules

- **Never edit a spec test to make it pass.** If a test is wrong, stop and commit
  `spec-conflict: <file or S-id> — <what the spec gets wrong>`; the ticket goes back to phase 1.
  `pnpm test-guard` fails an undeclared edit, and bending a test is the one failure this whole
  pipeline exists to prevent.
- Adding a *new* test for a case the spec missed is allowed and welcome; it does not touch the
  existing ones.
- No invented data. A stub returns an honest empty state and says so.
- Every money-moving write names an idempotency key. Every tenant-owned query is scoped.
- When a gate fails, read what it says before changing anything. A gate that fails for a reason
  you do not understand is a finding, not an obstacle.
