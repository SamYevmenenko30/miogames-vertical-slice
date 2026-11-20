---
id: MIO-013
title: "An end-to-end smoke run and the sample requests and responses"
column: 1-in-spec
type: chore
module: tooling
part: "B"
depends_on: [MIO-011, MIO-012]
spec: docs/specs/MIO-013.md
gates: { spec_gate: pass, red_check: pending, verify: pending, review: pending }
---
# MIO-013 — An end-to-end smoke run and the sample requests and responses

## Why now

A reviewer should be able to see all eight Part B steps happen on their own machine in under a minute, for both operators.

## Scope

- pnpm smoke: deposit -> entitlement -> spin -> coins -> redemption -> issuance -> status, printing each step
- the same run against operator B, whose dialect differs at both ends
- docs/samples/*.http with real captured requests and responses
- README: setup, assumptions, what is deliberately not built

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 6 statements, 2 questions |
| tests-from-spec | — | `red-check` | — |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
