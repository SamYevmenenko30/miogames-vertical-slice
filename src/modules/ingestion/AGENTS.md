# ingestion

The operator webhook: authenticate, validate, deduplicate, record, emit one event. It decides
nothing about rewards.

## Invariants this module enforces

- Deduplication is the primary key of `ingestion.dedup`, claimed with
  `ON CONFLICT DO UPDATE ... RETURNING` so the winner comes back whether we claimed it or not.
  `DO NOTHING` would return no row for a duplicate and force a second read, which can itself race.
- The envelope, the dedup claim and the outbox row are written in **one** transaction. There is
  no state in which an event was emitted but not recorded, or claimed but not emitted.
- An envelope is stored for every authenticated request, whatever the outcome, before
  interpretation. An unauthenticated request is logged, not stored — the table is tenant-owned
  and there is no tenant (MIO-004 Q2).
- An unsupported event type is **acknowledged** (202 `ignored`), not refused. An operator must
  not have to tell our feature set apart from an error.
- A duplicate answers 200, not 202, and carries the FIRST event id.
- The tenant written into a row comes from `currentTenantId()`, never from an argument.

## Traps

- The HMAC is over the **raw** body. `platform/http/raw-body.ts` hands `/v1/ingest` routes the
  body as text for exactly that reason: `JSON.stringify(JSON.parse(x))` is not `x`.
- Signature verification lives in `identity`, not here. Ingestion asks "is this signature valid
  for this key id" and never sees a secret.
- A reused operator event id for a genuinely different deposit is treated as a duplicate on
  purpose (MIO-004 Q1): the second envelope is stored, so the difference is auditable, and
  rewarding twice on an operator's bug is the more expensive mistake.
