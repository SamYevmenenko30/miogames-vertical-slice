# Tech debt ledger

Known, deliberate, and written down rather than discovered later. A cross-module promise that is
not enforced on the other side belongs here, not in a comment.

| ID | Item | Why it is debt | Cost of fixing |
| --- | --- | --- | --- |
| TD-0001 | Balance is a projection with no reconciliation job | `SUM(ledger_entry)` and `ledger_balance` can only diverge through a bug, but nothing would tell us | 1 day: a nightly job + a metric |
| TD-0002 | Outbox relay polls; no `LISTEN/NOTIFY` | Adds up to one poll interval of latency to event propagation | 0.5 day |
| TD-0003 | Retry schedule is per-redemption, not per-operator | One operator being down burns attempts for every redemption instead of opening a circuit | 2 days: a per-tenant circuit breaker in `integration` |
| TD-0004 | Entitlement expiry runs as a cron sweep | A spin on an expired-but-unswept entitlement is still accepted inside the sweep window | 0.5 day: check the TTL in the claim predicate as well |
| TD-0005 | No rate limiting on the player API | A player can hammer `/v1/spins`; correctness holds (entitlements run out) but the cost is ours | 1 day |
| TD-0006 | Admin API authorises by tenant key, with no roles | Any operator key can change that operator's wheel odds; there is no "read-only analyst" | 2 days once roles exist |
