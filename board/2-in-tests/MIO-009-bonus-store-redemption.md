---
id: MIO-009
title: "rewards: the bonus store and an idempotent redemption"
column: 2-in-tests
type: feature
module: rewards
part: "B, C"
depends_on: [MIO-008]
spec: docs/specs/MIO-009.md
gates: { spec_gate: pass, red_check: pass, verify: pending, review: pending }
---
# MIO-009 — rewards: the bonus store and an idempotent redemption

## Why now

Step 6 of Part B and the duplicate-redemption case. The debit and the intent must be one transaction; the external call must not be in it.

## Scope

- store_item per tenant (price in coins, reward payload), admin adapter to manage them
- POST /v1/redemptions with a required Idempotency-Key; a replay returns the first redemption and debits once
- debit + redemption(pending_issuance) + outbox in one transaction
- insufficient balance is a 409 problem+json, and the CHECK is still the backstop

## Not in this card

- Talking to the operator — MIO-010.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 10 statements, 2 questions |
| tests-from-spec | 2026-11-20 | `red-check` | PASS |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
