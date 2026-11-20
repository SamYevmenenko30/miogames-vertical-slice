---
id: MIO-016
title: 'Database timeouts: no statement, lock or idle transaction runs unbounded'
column: 3-in-progress
type: fix
module: platform
part: C
depends_on: [MIO-001]
spec: docs/specs/MIO-016.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pending }
---
# MIO-016 — Database timeouts

## Why now

Round two's should-fix S11: `createDatabase` passes `max`, `onnotice` and `transform` and nothing
else, and a grep for `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`,
`connect_timeout` and `idle_timeout` across `src`, `db` and `scripts` returns nothing. For a system
whose correctness rests on `SELECT … FOR UPDATE` over money rows, "no statement will ever be cut
off" is a decision worth making on purpose rather than by omission — and an idle transaction
holding a balance row is the exact shape of an outage that nothing here would end.

It became TD-0013 rather than a fix, and then the ledger row was taken as the work item.

## Scope

- Every pool the application opens carries `statement_timeout`, `lock_timeout` and
  `idle_in_transaction_session_timeout`, from configuration, with defaults.
- `connect_timeout` on the driver, so a dead database fails rather than hangs.
- Migrations keep NO statement timeout, deliberately and provably.
- TD-0013 is rewritten down to the one part that remains open: the pool's acquire queue.

## Not in this card

- A pool acquire timeout. `postgres.js` has no such option and the alternative is racing every
  query against a timer; the remainder stays in the ledger (MIO-016 spec Q2).
- Per-query or per-use-case overrides. One set of limits per pool until a measurement asks for more.
