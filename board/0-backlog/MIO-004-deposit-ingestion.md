---
id: MIO-004
title: "ingestion: HMAC authentication, validation, deduplication, envelope audit, one event"
column: 0-backlog
type: feature
module: ingestion
part: "B, C"
depends_on: [MIO-002, MIO-003]
spec: docs/specs/MIO-004.md
gates: { spec_gate: pending, red_check: pending, verify: pending, review: pending }
---
# MIO-004 — ingestion: HMAC authentication, validation, deduplication, envelope audit, one event

## Why now

Step 1 and 2 of Part B, and the first two Part C cases (duplicate events, unauthorized events). Dedup must be a constraint, not a lookup.

## Scope

- POST /v1/ingest/:operator/events with HMAC over the raw body, timestamp window, constant-time compare
- raw envelope persisted verbatim before interpretation
- dedup on UNIQUE (tenant_id, operator_event_id) via ON CONFLICT DO NOTHING; replay returns 200 + the original event id
- outbox write in the same transaction; 202 on first delivery

## Not in this card

- What a deposit causes — MIO-005.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | — | `spec-gate` | — |
| tests-from-spec | — | `red-check` | — |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
