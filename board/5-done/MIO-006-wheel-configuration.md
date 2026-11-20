---
id: MIO-006
title: "gamification: versioned wheel configuration and its admin adapter"
column: 5-done
type: feature
module: gamification
part: "A, C"
depends_on: [MIO-001]
spec: docs/specs/MIO-006.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pass }
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
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 7 statements, 2 questions |
| tests-from-spec | 2026-11-20 | `red-check` | PASS — 3 files red at the merge-base |
| implement-to-green | 2026-11-20 | `verify` | PASS — 151 tests |
| review | 2026-11-20 | `review:request` | PASS |

## Review findings

Three findings, one of them about a gate:

- **`red-check` was over-claiming its own verdict.** A test whose `beforeAll`
  failed on a table the branch adds was classified **assertion-red** — the
  strong result — because vitest prints the failing test's code frame, and the
  frame contains `expect(...).toBe(...)`, which matched the assertion pattern.
  The gate was reporting a stronger proof than the run earned. Unambiguous
  signals (missing module, missing relation/schema/column) are now checked
  first, and a probe asserts the classifier: it must accept that state and call
  it crash-red.
- **`spec-gate` silently ignored a mislabelled question.** This spec shipped a
  bullet written `- **S/Q1 — …**`, which did not match the question pattern, so
  nothing checked whether it was answered — while it was open. A bullet under
  `## Open questions` that is not a question now fails the gate, with a probe.
- **The append-only trigger does not cover `TRUNCATE`**, which the test cleanup
  then relied on. Kept, deliberately: a trigger that blocked `TRUNCATE` would
  block the suite's own cleanup, and the real control is privilege — the
  application role must not hold `TRUNCATE`. TD-0010, closed by MIO-011.
