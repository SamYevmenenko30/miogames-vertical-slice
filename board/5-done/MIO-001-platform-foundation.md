---
id: MIO-001
title: "Platform: config, unit-of-work, tenant-scoped queries, outbox, problem+json"
column: 5-done
type: chore
module: platform
part: "A, C"
depends_on: [MIO-000]
spec: docs/specs/MIO-001.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pass }
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
| implement-to-green | 2026-11-20 | `verify` | PASS — 19 unit + 30 integration |
| review | 2026-11-20 | `review:request` | PASS — all ten gates, raw output in `docs/ai/gate-runs/MIO-001-review-request.txt` |

## Review findings

Gates on `0de001d1` (base `6c58bcb9`): spec-gate, red-check, test-guard,
arch-check, board:check, lint, typecheck, tests, build, gate-probes — all PASS.

Findings from the implementation phase, all fixed here:

- **`verify` contradicted itself.** `board:check` honoured MIO-000's spec waiver
  and `spec-gate` did not, so the same tree was both acceptable and not. Two
  gates disagreeing is worse than either being wrong: it teaches people to
  ignore the one that is noisier. Both now read the waiver the same way.
- **`postgres` 4.x is ESM-only** and this is a CommonJS project — the build
  failed, not the tests, which is exactly the order in which a packaging problem
  should surface. Pinned to 3.x with the reason in TD-0008.
- **A `Date` as a raw `sql` parameter throws under vitest** but works under
  `tsx`, with `instanceof Date` true in both. Found by reproducing it in a
  throwaway spec rather than by guessing; raw parameters are now strings with an
  explicit cast, and the trap is in AGENTS.md.
- **red-check staged sibling spec files** as "support" for the file under
  measurement, because they live in the same `__tests__` directory. A sibling
  spec in the base worktree can manufacture the verdict of the file being
  measured. Fixed, and a probe now covers it.

Deferred, with a reason: TD-0001 (no ledger reconciliation job), TD-0002 (the
relay polls rather than using LISTEN/NOTIFY), TD-0008 (the postgres pin).
