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
| TD-0008 | `postgres` is pinned to 3.x because 4.x is ESM-only and this is a CommonJS project | NestJS, `tsc`, swc and vitest are all on the well-trodden CJS path here; going ESM means suffixing every relative import with `.js` | 1 day, as one change: `"type": "module"`, `moduleResolution: nodenext`, extensions everywhere, then unpin |
| TD-0009 | Operator signing secrets are encrypted with a key derived from `PLAYER_TOKEN_SECRET` by HKDF | One secret with two HKDF-separated purposes is sound, but a real deployment wants independent, rotatable, KMS-managed keys — and rotation here means re-encrypting every row | 2 days: a key-id column on the ciphertext, a KMS provider in `platform/crypto`, and a re-encrypt job |
| TD-0010 | Append-only is enforced by a TRIGGER; the withheld `DELETE`/`TRUNCATE` privilege is only the second half | `mio_app` is granted `UPDATE` on every table, `ledger.entry`, `gamification.spin`, `gamification.wheel_version` and `infra.audit_log` included, so `infra.refuse_mutation` is the only thing refusing an UPDATE. Privilege alone is not the control, and a trigger can be disabled by the table's owner | 0.5 day: revoke `UPDATE` on the append-only tables specifically, so privilege and trigger agree |

