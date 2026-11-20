# ADR-0005 — Money-shaped invariants live in the database

Status: Accepted · Date: 2026-11-20

## Context

"Financially relevant operations must not result in duplicate rewards or negative coin
balances." Coins are not legal tender, but they are earned, spent and exchanged for things that
cost the operator money. The code that moves them will be written partly by an AI agent and
reviewed under time pressure.

## Decision

The ledger is append-only, and its invariants are database constraints:

- `ledger_entry` — insert only. No `UPDATE`, no `DELETE`. A correction is a compensating entry.
- `ledger_entry.idempotency_key` — `UNIQUE (tenant_id, idempotency_key)`. Every caller must
  supply one derived from the cause, e.g. `spin:<spinId>`, `redemption:<id>`,
  `redemption:<id>:refund`.
- `ledger_balance` — one row per `(tenant_id, player_id)` with
  `CHECK (balance >= 0)`, updated in the same transaction as the entry.
- A debit is `UPDATE ledger_balance SET balance = balance - $1 WHERE ...` — the row lock
  serialises concurrent debits, and the CHECK aborts the transaction rather than letting the
  application decide.

The application layer may *also* check the balance to return a clean `409` instead of a
constraint violation, but that check is a user-experience nicety. The constraint is the
invariant.

## Consequences

- An attempt to overspend fails even if the application check is wrong, missing, or raced. The
  test suite asserts both paths: the friendly `409` and the constraint under concurrency.
- A duplicate credit is impossible rather than unlikely: the second insert hits the unique key
  and the whole transaction aborts.
- Balance is a cached projection of the entries. A reconciliation job (`SUM(entries)` vs
  `balance`) belongs in the 90-day plan; the slice ships the invariant, not the reconciliation.
- Append-only means the table grows. Partitioning by month is a scaling item, not a design
  change.

## Alternatives rejected

**Balance derived on read (`SUM` over entries).** Perfectly consistent and perfectly slow; and a
`CHECK` cannot be written against an aggregate, so the "never negative" rule would move back
into application code.

**Application-level guard only.** This is what unconstrained code generation produces: an
`if (balance < price) throw` that is correct in a unit test and wrong under two concurrent
requests.
