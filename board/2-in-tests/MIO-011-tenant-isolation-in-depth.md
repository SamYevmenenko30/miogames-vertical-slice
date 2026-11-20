---
id: MIO-011
title: "Tenant isolation in three layers, with a test per module"
column: 2-in-tests
type: feature
module: platform
part: "A, C"
depends_on: [MIO-010]
spec: docs/specs/MIO-011.md
gates: { spec_gate: pass, red_check: pass, verify: pending, review: pending }
---
# MIO-011 — Tenant isolation in three layers, with a test per module

## Why now

A forgotten WHERE clause is the realistic leak, not an exploit. One layer is a convention; three layers is a guarantee.

## Scope

- RLS policies on every tenant-owned table, driven by SET LOCAL app.tenant_id in the unit-of-work
- a non-owner application role so RLS actually applies
- another tenant's resource answers 404, never 403
- one isolation test per module, same shape; arch-check fails a module without one

## Not in this card

- Database-per-tenant — rejected in ADR-0006.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 8 statements, 2 questions |
| tests-from-spec | 2026-11-20 | `red-check` | PASS |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
