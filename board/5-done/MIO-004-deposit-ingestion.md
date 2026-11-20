---
id: MIO-004
title: "ingestion: HMAC authentication, validation, deduplication, envelope audit, one event"
column: 5-done
type: feature
module: ingestion
part: "B, C"
depends_on: [MIO-002, MIO-003]
spec: docs/specs/MIO-004.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pass }
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
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 9 statements, 2 questions |
| tests-from-spec | 2026-11-20 | `red-check` | PASS — 2 files red at the merge-base |
| implement-to-green | 2026-11-20 | `verify` | PASS — 113 tests |
| review | 2026-11-20 | `review:request` | PASS — nine gates (gate-probes skipped: no gate changed) |

## Review findings

**A cross-module design error, found only by building the consumer.** MIO-002
stored the operator secret as a SHA-256 digest and its own tests passed: the
spec said "never stored in the clear" and a digest satisfies that. But HMAC
verification needs the key itself, so the authentication this ticket depends on
was impossible as specified. Nothing in MIO-002 could have caught it — the
defect was in the relationship between two tickets, which is where the gates are
weakest and where reading the diff of either one in isolation tells you nothing.

Fixed by storing the secret encrypted (AES-256-GCM, HKDF-derived key) and moving
signature verification into `identity`, so the secret never leaves the module
that owns credentials. TD-0009 records that production wants independent,
rotatable, KMS-managed keys.

The lesson for the pipeline, recorded in `docs/ai/evidence-log.md`: a spec is
checked against the ticket, not against its consumers. A card whose output
another card consumes should name the consumer's requirement as a statement —
here, "the stored credential must support HMAC verification" would have failed
MIO-002 immediately.
