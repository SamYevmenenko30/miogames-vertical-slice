---
id: MIO-006
title: "gamification: versioned wheel configuration and its admin adapter"
column: 0-backlog
type: feature
module: gamification
part: "A, C"
depends_on: [MIO-001]
spec: docs/specs/MIO-006.md
gates: { spec_gate: pending, red_check: pending, verify: pending, review: pending }
---
# MIO-006 — gamification: versioned wheel configuration and its admin adapter

## Why now

An entitlement must pin the odds it was granted under. That is only possible if configuration is versioned and never updated in place.

## Scope

- wheel + wheel_version (slices with weights and prizes, weights summing to a declared total)
- PUT /v1/admin/wheels/:id creates a NEW version; nothing updates a live one
- validation: positive weights, at least two slices, prize shapes known
- every admin write lands in the audit log

## Not in this card

- The draw itself — MIO-007.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | — | `spec-gate` | — |
| tests-from-spec | — | `red-check` | — |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
