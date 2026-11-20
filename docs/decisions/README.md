# Decisions

Architecture decision records. One file per decision, numbered, never edited after it is
accepted — a decision that changes gets a new ADR that supersedes the old one, so the reasoning
history stays readable.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](ADR-0001-modular-monolith-first.md) | Modular monolith, two processes, one database | Accepted |
| [0002](ADR-0002-canonical-events-operator-dialects.md) | One canonical internal event; operator dialects only in adapters | Accepted |
| [0003](ADR-0003-idempotency-outbox-and-retries.md) | Idempotency keys + transactional outbox + worker retries | Accepted |
| [0004](ADR-0004-server-authoritative-deterministic-draw.md) | Server-authoritative deterministic draw with commit–reveal | Accepted |
| [0005](ADR-0005-ledger-invariants-in-the-database.md) | Money-shaped invariants live in the database | Accepted |
| [0006](ADR-0006-tenant-isolation-in-depth.md) | Tenant isolation in three layers, with a test per layer | Accepted |
| [0007](ADR-0007-spec-first-pipeline-for-ai-agents.md) | Spec-first pipeline with machine-checked gates for AI-written code | Accepted |
