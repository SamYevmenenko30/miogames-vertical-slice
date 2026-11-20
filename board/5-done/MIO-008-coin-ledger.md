---
id: MIO-008
title: "ledger: append-only entries, idempotent movements, a balance the database keeps non-negative"
column: 5-done
type: feature
module: ledger
part: "B, C"
depends_on: [MIO-001]
spec: docs/specs/MIO-008.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pass }
---
# MIO-008 — ledger: append-only entries, idempotent movements, a balance the database keeps non-negative

## Why now

Step 5 of Part B and the hard half of Part C. Everything that moves coins calls this, so the invariants belong here and in the schema.

## Scope

- ledger_entry: insert-only, UNIQUE (tenant_id, idempotency_key)
- ledger_balance: one row per player, CHECK (balance >= 0), updated in the same transaction
- facade: credit, debit, balanceOf, history — every one requiring an idempotency key
- concurrency: the balance row lock serialises debits; the CHECK is the backstop

## Not in this card

- Reconciliation job — TD-0001.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 10 statements, 2 questions |
| tests-from-spec | 2026-11-20 | `red-check` | PASS — 2 files red at the merge-base |
| implement-to-green | 2026-11-20 | `verify` | PASS — 128 tests |
| review | 2026-11-20 | `review:request` | PASS — nine gates |

## Review findings

**The append-only trigger and the idempotency idiom are incompatible, and the
first implementation copied the wrong one.** `ON CONFLICT DO UPDATE ...
RETURNING` is the neat way to learn who won a race in one statement — and it is
an UPDATE, which this table's trigger refuses. Every ledger test failed with
"entry is append-only: UPDATE is refused". Replaced with `DO NOTHING` plus a
read in the same transaction.

**That fix left two module AGENTS.md files contradicting each other** about
which idiom is right, each correct about its own table. Prose arguing with prose
is the thing a branch audit catches, and this repository has no branch-audit
gate — the one gate from the larger pipeline deliberately left out. Both files
now state the difference and why neither is wrong. Recorded in the evidence log
as a known gap rather than pretended away.
