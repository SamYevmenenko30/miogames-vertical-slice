---
id: MIO-010
title: "rewards: issuance through the operator adapter, with timeouts, retries, refunds and a status API"
column: 5-done
type: feature
module: rewards
part: "B, C"
depends_on: [MIO-009, MIO-003]
spec: docs/specs/MIO-010.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pass }
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
| tests-from-spec | 2026-11-20 | `red-check` | PASS |
| implement-to-green | 2026-11-20 | `verify` | PASS — 204 tests |
| review | 2026-11-20 | `review:request` | PASS |

## Review findings

Three findings; the first two are the interesting ones.

**The reward adapters were in the wrong module, and two different gates caught
it from opposite ends.** They went into `rewards` — the module that issues
rewards — and `no-operator-leak.spec.ts` failed because an operator's name now
appeared outside `integration`, while the boundary lint failed because
`integration`'s wiring was deep-importing a `rewards` adapter and `rewards`'
facade was re-exporting one. Neither gate knows about the other; they agreed
because the architecture model is coherent. That is the first time in this
repository two independent checks converged on one mistake, and it is the
strongest evidence so far that the model is doing work rather than decorating.

**A retry schedule measured on two clocks.** `next_attempt_at` was written from
the injected clock and compared against the database's. With a fixed clock in a
test the two differ by however long the suite has been running, so one drain
performed two attempts — and would have performed three on a slower machine.
This is the shape of a flaky retry test in every project that has one. Unified
on the injected clock; the outbox relay keeps the split on purpose and says why.

**"Timed out" does not match `/timeout/`.** Second time this exact shape has
cost a run. Deferred nothing, but worth the line in the evidence log: when a
test greps a message, the message is part of the contract.
