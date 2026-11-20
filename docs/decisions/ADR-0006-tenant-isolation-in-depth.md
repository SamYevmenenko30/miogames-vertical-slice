# ADR-0006 — Tenant isolation in three layers, with a test per layer

Status: Accepted · Date: 2026-11-20

## Context

A cross-tenant data leak is the one bug that ends a B2B platform. Part C lists tenant isolation
as a reliability requirement, and the realistic failure mode is not a dramatic exploit — it is a
`WHERE` clause an agent forgot in the fourteenth repository method.

## Decision

Three layers, each independently sufficient to stop the leak, and a test for each:

1. **Context, not parameters.** The tenant is resolved once per request (from the API key or the
   player token) into a `TenantContext` held in AsyncLocalStorage. Repositories obtain the tenant
   from the context; a query helper (`scoped(table)`) composes the `tenant_id` predicate. A
   repository method cannot be written without it, because there is no un-scoped accessor
   exported.
2. **The database refuses.** Row-level security on the tenant-owned tables, with the connection
   setting `app.tenant_id` set per transaction by the unit-of-work. A query that escapes the
   helper returns zero rows rather than someone else's.
3. **Shape of the answer.** A resource belonging to another tenant answers `404`, never `403` —
   a `403` confirms the id exists, which is itself a leak. Errors are problem+json with no
   cross-tenant detail.

Every module's integration suite carries one isolation test following the same pattern: seed two
tenants, act as tenant B against tenant A's identifiers, assert nothing is read, written or
counted. `pnpm arch-check` fails a module that has none.

## Consequences

- Isolation survives a forgotten predicate, which is the realistic defect. It also survives a
  wrong one, because RLS is evaluated independently of what the application believed.
- RLS costs a `SET LOCAL` per transaction and makes migrations and seeds explicit about which
  role they run as. Documented in [local-development](../local-development.md).
- The `404`-not-`403` rule occasionally confuses a legitimate caller who mistyped an id. That is
  the correct trade.

## Alternatives rejected

**A database per tenant.** The strongest isolation and the right answer for a handful of large
enterprise customers. Rejected: ten operators mean ten migration targets and ten connection
pools, and the product's own analytics then need a cross-database story. Revisit when a single
operator's compliance demands it — the module boundaries do not change, only `platform/db`.

**Tenant id as a method parameter everywhere.** Honest and explicit, and it fails the moment one
call site passes the wrong variable. The context makes the correct thing the only thing available.
