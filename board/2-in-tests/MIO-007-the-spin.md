---
id: MIO-007
title: "gamification: claim an entitlement exactly once and draw a verifiable outcome"
column: 2-in-tests
type: feature
module: gamification
part: "B, C"
depends_on: [MIO-005, MIO-008]
spec: docs/specs/MIO-007.md
gates: { spec_gate: pass, red_check: pass, verify: pending, review: pending }
---
# MIO-007 — gamification: claim an entitlement exactly once and draw a verifiable outcome

## Why now

Step 4 of Part B, the concurrent-spin case of Part C, and the anti-manipulation answer all land in one endpoint.

## Scope

- POST /v1/spins, player-authenticated; one conditional UPDATE claims the entitlement
- outcome = weightedPick(version.slices, uniform01(HMAC(seed, spinId))) — no client input
- spin row stores config version, seed, seed hash, index and prize
- coins credited in the same transaction, idempotency key spin:<id>
- response reveals the seed so the draw can be recomputed

## Not in this card

- Spending the coins — MIO-009.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 11 statements, 2 questions |
| tests-from-spec | 2026-11-20 | `red-check` | PASS |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
