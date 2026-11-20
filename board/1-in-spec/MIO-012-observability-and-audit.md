---
id: MIO-012
title: "Observability and auditability: request context, structured logs, append-only audit"
column: 1-in-spec
type: feature
module: platform
part: "A"
depends_on: [MIO-010]
spec: docs/specs/MIO-012.md
gates: { spec_gate: pass, red_check: pending, verify: pending, review: pending }
---
# MIO-012 — Observability and auditability: request context, structured logs, append-only audit

## Why now

In a money-shaped system "what happened to this redemption" has to be answerable from stored facts, not from reconstruction.

## Scope

- request context (trace id, tenant id, player id) in AsyncLocalStorage, on every log line
- audit_log: append-only, written for every admin change and every money movement
- /health with migration-version check; /v1/admin/audit to read it back
- the named metrics we would emit, listed honestly rather than faked

## Not in this card

- A metrics backend and dashboards — 90-day plan.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 6 statements, 2 questions |
| tests-from-spec | — | `red-check` | — |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
