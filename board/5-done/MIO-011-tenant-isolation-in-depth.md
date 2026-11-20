---
id: MIO-011
title: "Tenant isolation in three layers, with a test per module"
column: 5-done
type: feature
module: platform
part: "A, C"
depends_on: [MIO-010]
spec: docs/specs/MIO-011.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pass }
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
| implement-to-green | 2026-11-20 | `verify` | PASS — 211 tests, the whole suite through the application role |
| review | 2026-11-20 | `review:request` | PASS |

## Review findings

This card found three defects, and the first two are the reason defence in depth
is worth building rather than describing.

**1. The event consumers never told the database which tenant they were in.**
`IdempotentConsumer` opened the transaction and the handler entered the tenant
scope inside it — but `SET LOCAL app.tenant_id` happens at `BEGIN`, so the
database spent the whole transaction with no tenant. Every query was still
correctly scoped at the application level, so nothing failed, and nothing would
have failed until the day someone relied on the database half of the guarantee.
Row-level security turned a latent ordering bug into six red tests in one run.
The scope is now entered by the base class, around the transaction.

**2. `current_setting('app.tenant_id', true)` returns the empty string, not
NULL.** Only until the setting has been touched once on a connection — after
that the GUC exists and reads back as `''` when unset. On a pooled connection
the first request saw NULL and every later one saw `''`, so policies written
against NULL alone refused everything, including the credential lookup that
precedes any tenant. It presented as "the first request works and the rest
answer 401", which is a signature worth remembering. Fixed with
`nullif(..., '')` and written into AGENTS.md and the local-development guide.

**3. `pnpm dev` could never have worked.** `tsx` uses esbuild, which does not
emit decorator metadata, so Nest resolved the first constructor parameter of
every controller as `undefined`. The whole test suite passes because vitest uses
swc, which does emit it — so the demo path was broken while the measured path
was green. Nobody had run the dev script. `pnpm dev` now uses
`@swc-node/register`, and the API was booted and answered a request to prove it.

That third one is an argument for MIO-013 rather than a bug report: a path that
nothing automated exercises is a path that does not work, and the smoke run
exists to make the demo path measured.

TD-0010 is closed by this card: the application role no longer holds `DELETE` on
the append-only tables or `TRUNCATE` anywhere, which is the privilege-shaped
control the trigger could not be.
