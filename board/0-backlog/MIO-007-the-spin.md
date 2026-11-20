---
id: MIO-007
title: "gamification: claim an entitlement exactly once and draw a verifiable outcome"
column: 0-backlog
type: feature
module: gamification
part: "B, C"
depends_on: [MIO-005, MIO-008]
spec: docs/specs/MIO-007.md
gates: { spec_gate: pending, red_check: pending, verify: pending, review: pending }
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
| spec-harden | — | `spec-gate` | — |
| tests-from-spec | — | `red-check` | — |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
