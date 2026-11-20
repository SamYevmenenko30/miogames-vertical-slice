---
id: MIO-005
title: "gamification: reward rules turn a deposit into spin entitlements"
column: 2-in-tests
type: feature
module: gamification
part: "B, C"
depends_on: [MIO-004, MIO-006]
spec: docs/specs/MIO-005.md
gates: { spec_gate: pass, red_check: pass, verify: pending, review: pending }
---
# MIO-005 — gamification: reward rules turn a deposit into spin entitlements

## Why now

Step 3 of Part B. Rules are data so a new rule is a row; the rule evaluation is pure so it is testable without a database.

## Scope

- reward_rule per tenant (min deposit, currency, spins granted, wheel, TTL)
- a pure domain function: (deposit, rules) -> grants
- consumer of casino.deposit.observed, idempotent on processed_event
- spin_entitlement rows pinned to a wheel version, each with a committed server seed (hash stored, seed hidden)

## Not in this card

- Spending an entitlement — MIO-007.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 9 statements; tiers and TTL decided by Sam |
| tests-from-spec | 2026-11-20 | `red-check` | PASS |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
