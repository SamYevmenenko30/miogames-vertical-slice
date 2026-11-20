# Diagrams

All diagrams are Mermaid, so they render on GitHub and stay reviewable in a diff.

## Context — who talks to whom

```mermaid
flowchart LR
  subgraph Operators["Casino operators (tenants)"]
    A["Casino Platform A<br/><i>flat JSON, REST reward API</i>"]
    B["Casino Platform B<br/><i>enveloped JSON, command reward API</i>"]
  end

  P(["Player<br/><i>inside the operator's site</i>"])
  OPS(["MIO ops / operator admin"])

  subgraph MIO["MIO Games platform"]
    API["API process<br/>ingest · player · admin"]
    WRK["Worker process<br/>outbox relay · consumers · retries"]
    DB[("Postgres<br/>data · outbox · ledger · audit")]
  end

  A -- "deposit event (HMAC-signed)" --> API
  B -- "deposit event (HMAC-signed)" --> API
  P -- "spin / redeem / balance" --> API
  OPS -- "wheels, rules, store items" --> API
  API --> DB
  WRK --> DB
  WRK -- "issue reward (operator dialect)" --> A
  WRK -- "issue reward (operator dialect)" --> B
```

## Module map — the hexagons and the only legal edges

The linter enforces every arrow here and forbids every arrow that is not here
(`eslint.config.mjs`, rule `boundaries/dependencies`, `default: 'disallow'`).

```mermaid
flowchart TB
  classDef mod fill:#eef5ff,stroke:#4a7bc8,color:#123
  classDef plat fill:#f6f6f6,stroke:#999,color:#333

  ING["ingestion<br/><small>intake · dedup · envelope</small>"]:::mod
  INT["integration<br/><small>operator dialects · reward adapters</small>"]:::mod
  IDN["identity<br/><small>tenants · keys · players</small>"]:::mod
  GAM["gamification<br/><small>rules · wheels · spins · draw</small>"]:::mod
  LED["ledger<br/><small>coins · entries · balance</small>"]:::mod
  RWD["rewards<br/><small>store · redemptions · issuance</small>"]:::mod

  PLAT["platform<br/><small>config · db/unit-of-work · events/outbox · http · observability · crypto · clock · audit</small>"]:::plat

  ING -->|facade| IDN
  ING -->|facade| INT
  GAM -->|facade| IDN
  GAM -->|facade| LED
  RWD -->|facade| LED
  RWD -->|facade| INT
  RWD -->|facade| IDN

  ING -.-> PLAT
  INT -.-> PLAT
  IDN -.-> PLAT
  GAM -.-> PLAT
  LED -.-> PLAT
  RWD -.-> PLAT
```

Note what is **missing**: nothing points at `ingestion` or `rewards`, and `ledger` points at
nobody. The ledger is a leaf on purpose — it must never need to ask why a coin moved, because a
module that can be called from everywhere and calls nobody is a module whose invariants you can
actually prove.

Asynchronous edges do not appear above, because they are not imports. They are events:

```mermaid
flowchart LR
  ING -- "casino.deposit.observed" --> GAM
  GAM -- "gamification.spin.completed" --> OBS["audit / analytics<br/><small>(consumer; no module depends on it)</small>"]
  RWD -- "rewards.redemption.requested" --> ISS["issuance consumer<br/><small>(rewards, worker side)</small>"]
  ISS -- "rewards.redemption.failed" --> LEDR["ledger refund"]
```

## Sequence — deposit to issued reward

```mermaid
sequenceDiagram
  autonumber
  participant A as Casino A
  participant API as API
  participant DB as Postgres
  participant W as Worker
  participant PL as Player

  A->>API: POST /v1/ingest/casino-a/events (HMAC)
  Note over API: verify signature → tenant<br/>validate operator dialect<br/>translate to canonical
  API->>DB: BEGIN envelope + dedup key + outbox COMMIT
  API-->>A: 202 { eventId }  (replay → 200, same id)

  W->>DB: claim outbox batch
  W->>DB: BEGIN provision player<br/>evaluate rules → N entitlements<br/>(wheel version pinned, seed committed) COMMIT

  PL->>API: POST /v1/spins
  API->>DB: BEGIN claim entitlement (conditional UPDATE)<br/>draw = HMAC(seed, spinId) → prize<br/>credit coins (idempotency key = spinId) COMMIT
  API-->>PL: 200 { prize, coins, balance, fairness }

  PL->>API: POST /v1/redemptions (Idempotency-Key)
  API->>DB: BEGIN debit coins (CHECK balance >= 0)<br/>redemption 'pending_issuance'<br/>outbox COMMIT
  API-->>PL: 202 { redemptionId, status }

  W->>A: issueReward(...) with timeout
  alt success
    A-->>W: { reference }
    W->>DB: redemption 'issued'
  else retryable failure or timeout
    A-->>W: 5xx / timeout
    W->>DB: attempt++, next_attempt_at = backoff
    Note over W: retries until max attempts
    W->>DB: 'failed' + compensating credit (refund)
  end
  PL->>API: GET /v1/redemptions/:id → status, attempts, last error
```

## State machines — where the money-shaped invariants live

```mermaid
stateDiagram-v2
  [*] --> granted : rules evaluated (seed committed, wheel version pinned)
  granted --> consumed : spin claimed (conditional UPDATE — exactly one winner)
  granted --> expired : TTL passed
  consumed --> [*]
```

```mermaid
stateDiagram-v2
  [*] --> pending_issuance : coins debited in the same transaction
  pending_issuance --> issuing : worker claimed the job
  issuing --> issued : operator returned a reference
  issuing --> pending_issuance : retryable failure, backoff
  issuing --> failed : attempts exhausted → coins refunded
  issued --> [*]
  failed --> [*]
```

Two rules read straight off these diagrams:

- An entitlement has exactly one transition out of `granted` into `consumed`, and it is a
  conditional `UPDATE ... WHERE state = 'granted'`. Concurrency is settled by the database, not
  by an application-level check-then-act.
- `failed` is never terminal for the player's balance: leaving `issuing` without a reference
  refunds. The redemption and the refund are one transaction, keyed on the redemption id, so a
  worker that dies mid-refund retries into the same idempotency key instead of paying twice.
