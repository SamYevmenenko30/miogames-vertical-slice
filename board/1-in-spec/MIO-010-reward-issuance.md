---
id: MIO-010
title: "rewards: issuance through the operator adapter, with timeouts, retries, refunds and a status API"
column: 1-in-spec
type: feature
module: rewards
part: "B, C"
depends_on: [MIO-009, MIO-003]
spec: docs/specs/MIO-010.md
gates: { spec_gate: pass, red_check: pending, verify: pending, review: pending }
---
# MIO-010 — rewards: issuance through the operator adapter, with timeouts, retries, refunds and a status API

## Why now

Steps 7 and 8 of Part B and four Part C cases at once: timeouts, failed issuance, retries, eventual recovery.

## Scope

- CasinoRewardPort + adapters for operator A (REST) and B (command envelope), each with a timeout
- failure classified retryable vs terminal; exponential backoff with jitter on the redemption row
- attempts bounded; exhaustion -> failed + compensating credit keyed redemption:<id>:refund
- an operator that heals after two failures ends as issued — proven by test
- GET /v1/redemptions/:id exposes status, attempts and the last error

## Not in this card

- Per-operator circuit breaking — TD-0003.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 10 statements, 2 questions |
| tests-from-spec | — | `red-check` | — |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
