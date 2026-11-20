---
id: MIO-001
title: "Platform: config, unit-of-work, tenant-scoped queries, outbox, problem+json"
column: 2-in-tests
type: chore
module: platform
part: "A, C"
depends_on: [MIO-000]
spec: docs/specs/MIO-001.md
gates: { spec_gate: pass, red_check: pass, verify: pending, review: pending }
---
# MIO-001 — Platform: config, unit-of-work, tenant-scoped queries, outbox, problem+json

## Why now

Six modules will share exactly one transaction model, one error shape and one way to emit an event. Building that twice is how the invariants diverge.

## Scope

- platform/config — typed env, the only reader of process.env
- platform/db — Drizzle client, UnitOfWork on AsyncLocalStorage, scoped(table) that refuses without a tenant in context
- platform/events — outbox table + writer, relay loop, idempotent consumer base on processed_event
- platform/http — RFC 9457 problem+json filter, Idempotency-Key handling
- platform/{observability,crypto,clock,audit}
- docker-compose.yml, migration runner, /health

## Not in this card

- RLS policies — MIO-011 adds them with their tests.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 19 statements, 2 questions (both agent defaults, recorded) |
| tests-from-spec | 2026-11-20 | `red-check` | PASS — 7 files, every one red at the merge-base |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
