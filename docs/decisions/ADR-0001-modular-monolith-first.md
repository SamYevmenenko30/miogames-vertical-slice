# ADR-0001 — Modular monolith, two processes, one database

Status: Accepted · Date: 2026-11-20

## Context

The assignment asks which components should start as modules and which need to be independent
services. The system has eight named capabilities and a correctness requirement that is
financial in character: no duplicate rewards, no negative balances. The realistic team for an
MVP is three to four engineers (see [90-days.md](../plan/90-days.md)).

## Decision

One deployable with two processes — `api` and `worker` — over one Postgres. Six business modules
(`identity`, `integration`, `ingestion`, `gamification`, `ledger`, `rewards`), each a hexagon
with `domain → application → adapters`, communicating only through a facade (`index.ts`).

The boundaries are enforced by the linter, not by convention: `boundaries/dependencies` with
`default: 'disallow'`, so a cross-ring or cross-module import fails `pnpm verify` and CI. Deep
imports into another module's internals are additionally banned by path pattern, so adding a new
element type cannot silently open a hole.

## Consequences

- Every use-case is one database transaction. "Credit coins and emit the event" and "debit coins
  and record the redemption intent" are atomic without a saga. This is the single largest source
  of the reliability properties in Part C.
- Module extraction stays cheap, because the seam already exists: a facade call becomes a client
  call and an event already travels through an outbox.
- We pay for it with a shared failure domain (one bad deploy affects everything) and with a
  shared scaling curve. The mitigation is process separation — a blocked outbound call in the
  worker never ties up an API request — and the extraction order in
  [architecture/README.md §6](../architecture/README.md).
- The temptation this guards against is a "shared" module. There is no `common` module and no
  `admin` module; admin endpoints are inbound adapters on the module that owns the data.

## Alternatives rejected

**Services from day one (ingestion / rules / ledger / issuance).** Buys independent scaling and
team autonomy we do not have, and costs a distributed transaction between the coin ledger and
everything that moves coins. The first bug class it introduces — a reward issued twice because a
retry crossed a service boundary without an idempotency contract — is exactly what the
assignment tests for.

**A single-layer application (controllers calling the database).** Faster for a prototype and
the normal outcome of AI-assisted code generation left unconstrained. It makes the rules engine
untestable without a database, and it is the reason the boundary gate exists: with an agent
writing most of the code, the architecture holds only if a machine refuses the shortcut.
