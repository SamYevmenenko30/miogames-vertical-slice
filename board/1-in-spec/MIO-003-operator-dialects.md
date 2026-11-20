---
id: MIO-003
title: "integration: two operator dialects translated into one canonical deposit event"
column: 1-in-spec
type: feature
module: integration
part: "B, E"
depends_on: [MIO-001]
spec: docs/specs/MIO-003.md
gates: { spec_gate: pass, red_check: pending, verify: pending, review: pending }
---
# MIO-003 — integration: two operator dialects translated into one canonical deposit event

## Why now

This is the card that decides whether operator #10 costs a day or a sprint. The dialect must be the only thing that varies.

## Scope

- contracts/events: casino.deposit.observed (Zod), Money value object
- inbound adapters: platform A (flat, major units) and platform B (envelope, minor units)
- an operator registry keyed by tenant; no operator name outside this module
- mocks/casino-platform: both operators as a real HTTP service with injectable latency, 5xx and malformed replies

## Not in this card

- The outbound reward API — MIO-010.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 9 statements, 2 questions |
| tests-from-spec | — | `red-check` | — |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
