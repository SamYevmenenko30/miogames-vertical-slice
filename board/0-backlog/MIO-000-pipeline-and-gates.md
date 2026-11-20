---
id: MIO-000
title: "The pipeline: spec-first phases, the gate set, and probes that prove the gates bite"
column: 0-backlog
type: chore
module: tooling
part: "D"
depends_on: []
spec: docs/specs/MIO-000.md
gates: { spec_gate: pending, red_check: pending, verify: pending, review: pending }
---
# MIO-000 — The pipeline: spec-first phases, the gate set, and probes that prove the gates bite

## Why now

Everything after this card is written mostly by an agent. The gates are what make that safe, so they come first — and a gate nobody has watched fail is not a gate, hence the probes.

## Scope

- scripts/: verify, spec-gate, red-check, test-guard, arch-check, board, review-request, gate-probes
- .claude/skills/: the four phase skills the agent is actually run with
- board/ columns + this card set; CI running the same gates

## Not in this card

- No code in src/ — this card builds the machine, not the product.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | — | `spec-gate` | — |
| tests-from-spec | — | `red-check` | — |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
