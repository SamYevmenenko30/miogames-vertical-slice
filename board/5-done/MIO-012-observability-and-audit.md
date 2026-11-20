---
id: MIO-012
title: "Observability and auditability: request context, structured logs, append-only audit"
column: 5-done
type: feature
module: platform
part: "A"
depends_on: [MIO-010]
spec: docs/specs/MIO-012.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pass }
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
| tests-from-spec | 2026-11-20 | `red-check` | PASS |
| implement-to-green | 2026-11-20 | `verify` | PASS — 221 tests |
| review | 2026-11-20 | `review:request` | PASS |

## Review findings

No defects. One design point a reviewer should check rather than take on trust:
the audit reader lives in `platform/audit`, with the table it reads, and
authenticates through a **port** that the composition root fills with the
identity facade. Platform may not import a business module, and the easy way out
— importing `IdentityFacade` here — would have been invisible in review and
caught by the linter. It was worth the eight lines: `platform` stays free of
business knowledge, and the one place the two meet is the composition root,
where a reader expects to find wiring.

The metric list in `docs/observability.md` is deliberately a list and not a
dashboard. `ledger_balance_drift` is the one to read first: it can only be
non-zero through a bug, which is exactly why it has to be measured rather than
assumed (TD-0001).
