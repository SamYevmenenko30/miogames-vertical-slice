---
id: MIO-008
title: "ledger: append-only entries, idempotent movements, a balance the database keeps non-negative"
column: 0-backlog
type: feature
module: ledger
part: "B, C"
depends_on: [MIO-001]
spec: docs/specs/MIO-008.md
gates: { spec_gate: pending, red_check: pending, verify: pending, review: pending }
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
| spec-harden | — | `spec-gate` | — |
| tests-from-spec | — | `red-check` | — |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
