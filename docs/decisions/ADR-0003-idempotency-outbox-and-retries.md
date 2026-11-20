# ADR-0003 — Idempotency keys, a transactional outbox, and worker retries

Status: Accepted · Date: 2026-11-20

## Context

Part C asks for duplicate deposit events, duplicate redemptions, concurrent spins, external API
timeouts, failed issuance, and eventual recovery — with no duplicate rewards and no negative
balances. Every one of those is the same question asked six ways: *what happens when a message
arrives twice or a call does not come back?*

## Decision

Three mechanisms, each with one owner:

1. **Deduplication at the edge, by constraint.** `ingestion` stores a dedup key
   `(tenant_id, operator_event_id)` with a unique index and `INSERT ... ON CONFLICT DO NOTHING`.
   A second delivery finds the conflict, returns `200` with the original event id, and causes no
   second effect. Not "SELECT then INSERT" — that is a race with itself.
2. **A transactional outbox.** A use-case writes its state change and its outgoing events in the
   same transaction. The worker relays them at-least-once. There is no code path where coins are
   credited and the event is lost, or the event fires and the coins are not there.
3. **Idempotent consumers and idempotent money.** Every consumer records
   `(consumer, event_id)` in a processed-event table inside its own transaction, so a redelivery
   is a no-op. Every ledger entry carries a unique idempotency key derived from its cause (spin
   id, redemption id, `redemption:<id>:refund`), so at-least-once delivery cannot double-pay.

For outbound calls: a timeout (default 2s), failure classified as retryable (timeout, 5xx,
connection) or terminal (4xx, invalid payload), exponential backoff with jitter on the redemption
row, bounded attempts, then `failed` plus a compensating refund.

## Consequences

- "Exactly once" is achieved where it matters — *effects* — while delivery stays at-least-once,
  which is the only thing a distributed system can actually offer.
- Every money-moving call site must name its idempotency key. That is a deliberate friction: a
  key that cannot be named means the operation is not safely retryable, and that is a design bug
  surfacing early.
- The outbox adds a worker and a few milliseconds of latency to event propagation. Acceptable:
  nothing in the player's request path waits on it.
- At-least-once with bounded retries means a redemption can sit `pending_issuance` for minutes
  under an operator outage. That is visible in the status API rather than hidden, and the refund
  path makes it financially neutral.

## Alternatives rejected

**A message broker now (SQS, Kafka).** Needs a second durable store and reintroduces the
dual-write problem the outbox exists to remove. [scaling.md](../scaling.md) adds a log in front
of ingestion when a single operator's peak demands it, keeping the outbox as the write path.

**Application-level dedup caches (Redis `SETNX`).** Fast and lossy: a cache eviction turns a
duplicate deposit into a duplicate reward. Correctness invariants belong in the store that has
transactions.
