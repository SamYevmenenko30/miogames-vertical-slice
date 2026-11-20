# Observability

What this slice emits, and what a production deployment would add. The second list is honest
rather than implemented: a dashboard of invented numbers is worse than a list of the numbers that
would matter.

## What is here

- **A trace id per request**, returned as `X-Trace-Id` on every response including errors, and
  present on every log line written during that request (`AsyncLocalStorage`, attached at log
  time so a line written deep inside a use-case still carries it).
- **Structured JSON logs** with `traceId`, `tenantId`, `playerId` and `operator` where known, and
  redaction of `secret`, `apiKey`, `signature`, `authorization`, `token` and `password`.
- **An append-only audit log** (`infra.audit_log`) for every configuration change, readable per
  tenant at `GET /v1/admin/audit`. Enforced append-only by trigger, and by the application role
  holding no `DELETE` or `TRUNCATE`.
- **The facts that make a spin auditable without logs at all**: the spin row stores the wheel
  version, the server seed, its committed hash, the slice and the prize, so an outcome can be
  recomputed years later.
- **`/health`** reporting the applied schema version, and `503` when the database is unreachable.
  The worker has its own health port.
- **The redemption lifecycle as data**: `status`, `attempts`, `last_error`, `external_ref`,
  `next_attempt_at` — "what happened to this redemption" is a row, not a log search.

## What production would add, and why

| Metric or signal | Why it is the one worth paging on |
| --- | --- |
| `ingest_events_total{operator,outcome}` | A fall in `accepted` for one operator is their outage or our auth breaking; the split by outcome tells which |
| `ingest_signature_failures_total{key_id}` | A rotation gone wrong, or someone probing. Both need to be visible within minutes |
| `outbox_lag_seconds` (oldest unpublished row) | The single number that says "events are being processed". Everything downstream is a consequence of it |
| `outbox_attempts_total{event,outcome}` | A consumer failing repeatedly is invisible in a success-rate metric |
| `spins_total{wheel,version,slice}` | The distribution of outcomes against the configured weights. A drift here is either a bug or a dispute, and both are expensive |
| `ledger_balance_drift` (sum of entries vs balance) | TD-0001. It can only be non-zero through a bug, which is exactly why it must be measured |
| `redemption_issuance_duration_seconds{operator}` | Per operator, because a slow operator and a slow platform need different responses |
| `redemptions_failed_total{operator,reason}` | Every one of these refunded a player. A rise is a commercial conversation |
| `redemption_pending_age_seconds` | A redemption stuck in `pending_issuance` is a promise we have not kept |

Tracing: W3C trace context in from the operator (validated `traceparent`, not the trace id we
return), spans across ingest → worker → operator call. Logs: shipped, with the trace id as the
join key. None of it is wired here, and the 90-day plan says in which week it would be.
