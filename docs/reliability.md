# Part C — reliability and security, case by case

Every case the assignment lists, with the mechanism that handles it and the test that proves it.
Test names are greppable: each begins with the spec statement it proves.

| Case | Mechanism | Proof |
| --- | --- | --- |
| **Duplicate deposit events** | `ingestion.dedup` primary key on `(tenant_id, operator_event_id)`, claimed with `ON CONFLICT DO UPDATE … RETURNING` in the same transaction as the envelope and the outbox row | `ingest.integration.spec.ts` S2 (replay returns the first event id, no second outbox row), S3 (five concurrent deliveries → one event), and `pnpm smoke` step 7 |
| **Concurrent spin requests** | The entitlement leaves `granted` by a conditional `UPDATE … WHERE state = 'granted'` with `FOR UPDATE SKIP LOCKED` in the sub-select | `spin.integration.spec.ts` S4 — two parallel spins on one entitlement: exactly one 200 and one 409, one spin row, at most one ledger entry |
| **Duplicate redemption requests** | `UNIQUE (tenant_id, player_id, idempotency_key)`; a replay returns the first redemption and debits nothing | `redemption.integration.spec.ts` S3, S9 (five concurrent duplicates → one redemption), S4 (the same key from another player is a different redemption) |
| **External API timeouts** | `AbortController` with `ISSUANCE_TIMEOUT_MS` per call, classified *retryable*, backoff on the redemption row | `issuance.integration.spec.ts` S3 — the operator is told never to answer; the attempt ends, `attempts` becomes 1, `next_attempt_at` moves into the future |
| **Failed reward issuance** | Failure classified *retryable* (timeout, connection, 5xx) or *terminal* (4xx, no reference, unknown operator). Terminal fails immediately | `issuance.integration.spec.ts` S4 — a 5xx retries, a 4xx is terminal and does not consume the attempt budget |
| **Retries and eventual recovery** | Exponential backoff with jitter, capped, stored on the row so a restarted worker resumes; bounded attempts. A worker that dies mid-issuance is covered separately, by the claim's LEASE — the backoff is on the row, but a row in `issuing` has no schedule to resume | `issuance.integration.spec.ts` S5 — an operator that fails twice then recovers ends `issued` with `attempts: 2`; S11 — a worker killed **at** the operator call (its stub throws instead of calling, so no grant is requested) is recovered once its lease expires; S12 — and so is a row left with no lease at all. The other half, a worker killed **after** the operator granted, is `issuance-claim.integration.spec.ts` S9: also recovered, and the second grant request is recorded. This row used to cite S11 for both, which was the dangerous half cited by the harmless one |
| **No duplicate rewards** | `UNIQUE (tenant_id, idempotency_key)` on every ledger entry; keys derived from the cause (`spin:<id>`, `redemption:<id>`, `redemption:<id>:refund`). The operator call carries `redemption:<id>` too — but honouring it is the operator's choice, so it makes a re-claim **reconcilable, not safe**: the claim records `grant_requests` before the call, `> 1` means the operator may have granted twice, and that is a reported number and a log line rather than a guarantee (TD-0011). What IS guaranteed on our side is that the player is charged once, that two racing workers ask only once between them, and that a worker whose lease expired cannot write its outcome over a peer's | `ledger.integration.spec.ts` S5 (replayed credit and debit move nothing twice), `issuance.integration.spec.ts` S7 (the refund is idempotent), S10 (two racing workers ask the operator exactly once, counted at the operator); `issuance-claim.integration.spec.ts` S1–S3 (a stale lease holder changes nothing: no refund of an issued reward, no resurrection of one), S8–S9 (one grant request on a clean issuance, two after a recovery) |
| **No negative balances** | `CHECK (coins >= 0)` on `ledger.balance` is the invariant. `SELECT … FOR UPDATE` on the balance row decides WHICH answer the loser gets, not whether the money is safe: without it the loser passes the application check on a stale read and is refused by the constraint, i.e. a 500 instead of a 422 | `ledger.integration.spec.ts` S4 (the constraint refuses a direct `UPDATE` — this is the invariant), S3 (a debit beyond the balance, and a debit of exactly the balance, which is the boundary), S6 (two concurrent debits of 60 against 100 end at 40, **and the loser's refusal is the 422**, which is what pins the lock) |
| **Tenant isolation** | Three layers: the tenant in context with no un-scoped accessor; Postgres row-level security as the application role; `404` never `403` | One isolation test per module, plus `row-level-security.integration.spec.ts` S1–S7. S7 enumerates every `tenant_id` table in **every** non-system schema and names the single documented exception (`infra.outbox`), so a new table — or a new module's whole schema — without a policy fails. It used to enumerate five hardcoded schemas, which a new schema simply sat outside |
| **Invalid or unauthorized events** | HMAC over `${timestamp}.${rawBody}` with a tolerance window, verified inside `identity` so the secret never leaves it; wrong secret, unknown key and stale timestamp are indistinguishable | `ingest.integration.spec.ts` S4 — all three answer the same 401 with the same problem type, and no envelope is stored |

## Preventing manipulation of the odds, and unauthorized spins

The assignment asks how a player is prevented from influencing reward probabilities or spinning
without permission. Four mechanisms, none of them a check that can be forgotten:

1. **Nothing the client sends is an input to the outcome.** The slice is
   `weightedPick(pinnedSlices, uniform01(serverSeed, spinId))`. There is no `clientSeed`, no
   stake, no timestamp. `spin.integration.spec.ts` S3 posts `clientSeed`, `stake` and
   `preferredSlice` and asserts the outcome is still exactly the function of (seed, spin id).
2. **The odds are pinned before the player acts.** The entitlement stores the wheel *version* it
   was granted under, and `wheel_version` is append-only. An admin changing the wheel mid-flight
   cannot change the odds of a spin already granted.
3. **The seed is committed before the draw and revealed after it.** `sha256(seed)` is stored when
   the entitlement is granted; the spin response returns the seed. A player — or a regulator —
   recomputes the result and sees that the server did not choose the outcome after the fact. The
   smoke run does exactly this recomputation, independently of the implementation.
4. **A spin requires an entitlement row belonging to this tenant and this player**, still
   `granted` and unexpired, consumed by one conditional `UPDATE`. There is no endpoint that spins
   without consuming one, and no path from a client-supplied identifier to an entitlement.

What is *not* defended here, stated rather than implied: a compromised platform secret would let
an insider predict outcomes (the seed is per entitlement and hidden until after the draw, so a
player cannot), and there is no rate limiting on the player API — correctness holds because
entitlements run out, but the cost of the traffic is ours (TD-0005).
