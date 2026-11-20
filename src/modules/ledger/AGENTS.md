# ledger

Virtual currency. Append-only entries and a balance the database refuses to let go negative.

## Invariants this module enforces

- `CHECK (coins >= 0)` on `ledger.balance` is the invariant. The application's own balance read
  exists only to return a friendly `422` instead of a constraint violation — if that read were
  wrong, missing or raced, the transaction would still abort.
- `UNIQUE (tenant_id, idempotency_key)` on every entry. A replayed credit or debit returns the
  first entry and moves nothing.
- `CHECK (coins > 0)` and a `direction` column: no signed amounts, so no aggregate over this
  table depends on a sign convention. A correction is a `debit` with a reason.
- Entries are insert-only, enforced by trigger.
- `SELECT ... FOR UPDATE` on the balance row serialises concurrent debits. Be precise about what
  it buys: the `CHECK` is what keeps the balance non-negative, so removing the lock does not lose
  money — it changes the loser's answer from a friendly `422` to a constraint violation, i.e. a
  500. `ledger.integration.spec.ts` S6 now asserts WHICH refusal the loser gets, because asserting
  only that one of them was rejected passed with the lock deleted.

## Traps

- This module is a **leaf**: it imports no other module, and it must stay that way. A ledger that
  can call out is a ledger whose transaction boundary you cannot reason about.
- `recordEntry` uses `ON CONFLICT DO NOTHING` and then reads, while `ingestion.dedup` uses
  `ON CONFLICT DO UPDATE ... RETURNING`. The difference is this table's append-only trigger: a
  `DO UPDATE` *is* an UPDATE and the trigger refuses it (which is how this was found — the first
  implementation failed every test with "entry is append-only: UPDATE is refused"). The following
  read is safe because a new statement under READ COMMITTED takes a fresh snapshot.
- `balanceOf` returns 0 for an unknown player and creates nothing. Only a movement creates a
  balance row.
