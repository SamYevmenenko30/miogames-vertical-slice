# Architecture — MIO Games vertical slice

> Part A of the assignment. The diagrams are in [diagram.md](diagram.md); the model this
> repository is checked against is [architecture.yaml](architecture.yaml) (`pnpm arch-check`).

## 1. What the product is, in one paragraph

MIO Games sells gamification to online casino operators. An operator keeps its own players,
wallet and payment flow; it sends us *signals* ("this player deposited €50") and we turn them
into *engagement*: wheel spins, virtual coins, a bonus store, and rewards that are issued back
into the operator's own system. We are therefore a **multi-tenant B2B platform whose currency is
other people's player events**, and three properties follow from that sentence:

1. **Every row belongs to a tenant.** One operator must never see, spin for, or spend another
   operator's coins. Isolation is not a feature, it is the product's licence to exist.
2. **Every operator speaks its own dialect.** Their event schemas and reward APIs differ and we
   do not get to change them. What must not differ is the gamification logic behind them.
3. **Coins are money-shaped.** They are not real money, but they are earned, spent, and
   exchanged for things with cost. Duplicate rewards and negative balances are not bugs to fix
   later; they are the invariants the design is built around.

## 2. Shape of the system

A **modular monolith with two processes** — an HTTP API and a worker — over one Postgres.
Six business modules, each a hexagon (domain → application → adapters), talking to each other
only through a facade. See [ADR-0001](../decisions/ADR-0001-modular-monolith-first.md) for why
this is not a compromise but the correct first architecture, and §6 for what leaves it first.

| Module | Owns | Does not own |
| --- | --- | --- |
| `identity` | Tenants, API credentials, players, external↔internal player mapping | Anything a player *has* |
| `integration` | The operator catalogue; inbound event dialects; outbound reward APIs | What a reward means |
| `ingestion` | Webhook intake: authentication, validation, deduplication, raw envelope audit | What an event causes |
| `gamification` | Reward rules, versioned wheel configurations, spin entitlements, the draw | Coin balances |
| `ledger` | Coin accounts, append-only entries, the balance invariant | Why a coin moved |
| `rewards` | Bonus store, redemption lifecycle, issuance orchestration, status | How an operator is called |

Platform (no business knowledge, and the linter enforces that it imports no module):
`config`, `db` (Drizzle + unit-of-work), `events` (transactional outbox, relay, idempotent
consumers), `http` (problem+json, auth, idempotency keys), `observability`, `crypto`, `clock`,
`audit`.

### Admin configuration is not a module

Wheel tables, reward rules and store items are configured through `/v1/admin/...`, but there is
no `admin` module. Admin is an **inbound adapter on the module that owns the data** —
`gamification/adapters/in/admin-wheels.controller.ts` writes wheel versions, `rewards`' own admin
adapter writes store items. An `admin` module would need read-write access to every other
module's tables, which is how a god-module and a shared-database-in-one-process is born. The
linter makes the alternative impossible: nothing outside `gamification` can see
`gamification/domain`.

## 3. The nine capabilities the assignment lists, and where each lives

| Capability | Where | The decision that matters |
| --- | --- | --- |
| Multi-tenant SaaS with tenant isolation | `platform/db` + every module | `TenantContext` in AsyncLocalStorage; repositories cannot build a query without it; Postgres RLS as the second line. [ADR-0006](../decisions/ADR-0006-tenant-isolation-in-depth.md) |
| Casino integration layer, different external APIs | `integration` | One canonical internal event; operator dialects live in adapters only. [ADR-0002](../decisions/ADR-0002-canonical-events-operator-dialects.md) |
| Player identity mapping | `identity` | `(tenant_id, external_player_id)` unique; players auto-provision on first event, never on a guess |
| Event ingestion, validation, dedup, processing | `ingestion` | Accept-then-process: persist the envelope, answer 202, do the work in the worker. Dedup is a unique index, not a lookup-then-insert. [ADR-0003](../decisions/ADR-0003-idempotency-outbox-and-retries.md) |
| Gamification rules engine | `gamification` | Rules are data (per-tenant rows), evaluated by a pure domain function. A new rule type is code; a new rule is a row |
| Virtual currency ledger | `ledger` | Append-only entries + a balance row with a `CHECK (balance >= 0)`; every write carries an idempotency key. [ADR-0005](../decisions/ADR-0005-ledger-invariants-in-the-database.md) |
| Reward redemption and delivery | `rewards` | Debit and intent in one transaction; the external call in the worker; failure refunds. |
| Admin configuration | inbound adapters | Configuration is **versioned, never updated in place** — an in-flight spin keeps the odds it was granted under |
| Observability, auditability, security | `platform/*` | Structured logs carry `tenant_id` + `trace_id`; every spin stores the seed, the seed hash and the config version it drew from; HMAC on every webhook |

## 4. The one flow, end to end

The numbered steps are the assignment's Part B. See
[diagram.md § Sequence](diagram.md#sequence--deposit-to-issued-reward) for the same thing as a
diagram.

```
(1) POST /v1/ingest/casino-a/events        operator A dialect, HMAC-signed
      └─ ingestion: auth → validate → translate (integration) → envelope row
         → INSERT ... ON CONFLICT DO NOTHING on (tenant_id, operator_event_id)
         → outbox: casino.deposit.observed                      [one transaction]
      → 202 { eventId }   (a replay returns 200 and the same eventId)

(2,3) worker consumes casino.deposit.observed
      └─ identity: resolve/provision the player
      └─ gamification: evaluate the tenant's rules → grant N spin entitlements,
         each pinned to a wheel CONFIG VERSION and carrying a committed server
         seed (hash stored, seed hidden)                        [one transaction]

(4) POST /v1/spins          player-authenticated
      └─ gamification: claim one entitlement with a conditional UPDATE
         (only the row still 'granted' moves to 'consumed' — so two concurrent
         spins cannot both win), draw the outcome from HMAC(seed, spinId),
         record the spin with (config version, seed, seed hash, index),
(5)      └─ ledger: credit coins, same transaction, idempotency key = spin id
      → 200 { outcome, coins, balance, fairness: { seedHash, seed, configVersion } }

(6) POST /v1/redemptions    Idempotency-Key required
      └─ rewards: price the store item, ledger.debit (balance CHECK refuses to go
         negative), redemption row 'pending_issuance',
         outbox: rewards.redemption.requested                   [one transaction]
      → 202 { redemptionId, status }

(7) worker consumes rewards.redemption.requested
      └─ integration: the tenant's reward adapter (operator A's REST shape or
         operator B's envelope shape), with a timeout
      └─ success → 'issued' + external reference
         retryable failure → attempt++, exponential backoff, try again
         out of attempts → 'failed' + ledger.refund (compensating credit)

(8) GET /v1/redemptions/:id → the lifecycle, including attempts and last error
```

## 5. Why these technical choices

**Postgres for everything, including the queue.** The slice needs a transactional outbox, an
idempotency store, an append-only ledger and a job table. Postgres does all four with real
constraints, and one `BEGIN` covers "coins credited" and "event emitted" — which is the whole
reason there is no lost-reward class of bug here. A broker (SQS/Kafka) buys throughput we do not
have and costs a two-phase problem we cannot afford yet; §6 says when that trade flips.

**NestJS + TypeScript.** Dependency injection is what makes a port substitutable in a test
without a mocking framework: `CasinoRewardPort` is a token, the fake operator is a provider. The
type system carries the money types (`Coins`, `Money`) so a cents/euros mix-up is a compile
error.

**Drizzle, not an ORM with lazy loading.** Queries are explicit SQL-shaped TypeScript; the
tenant filter is visible at every call site, which is exactly what an isolation review needs to
read. Migrations are plain SQL files, applied explicitly — never on application boot (a boot-time
migration on a multi-replica deploy is a race).

**One transaction per use-case, opened in the application layer.** A unit-of-work on
AsyncLocalStorage; repositories enlist in it. The rule: a synchronous call into another module is
allowed only when its result is needed for *your* transaction to be correct. Otherwise it is an
event. Litmus test — "would the user's request still be correct if this ran five seconds later?"
If yes, it is an event.

**Deterministic, server-authoritative draw with commit–reveal.** Nothing the client sends enters
the outcome function. The outcome is `HMAC-SHA256(server_seed, spin_id)` folded into the weighted
table of the *pinned* config version. The seed's hash is written when the entitlement is granted
and the seed is revealed after the spin, so a player (or a regulator) can recompute the result
and see that we did not pick the outcome after seeing the stake.
[ADR-0004](../decisions/ADR-0004-server-authoritative-deterministic-draw.md).

## 6. Modules now, services later — and in what order

Today: one deployable, two processes (`api`, `worker`), one database. Three or four engineers
cannot operate six services, and every one of the assignment's correctness properties is cheaper
to hold inside one transaction than across a saga.

What leaves first, with the trigger that makes it leave:

| Extraction | Trigger | Why it is first |
| --- | --- | --- |
| **Ingestion** | A single operator's peak exceeds what one API process should absorb, or we must never drop an event while the core is deploying | It is already accept-then-process: a durable log in front changes nothing downstream |
| **Issuance worker** | Operator APIs need per-operator rate limits, circuit breakers and separate on-call | It is pure external I/O with a retry table; its blast radius should not include the player API |
| **Integration adapters** | Operator #10, or a partner team shipping its own adapter | Adapters become *plugins* (schema + mapping as configuration) before they become services — see [scaling.md](../scaling.md) |
| **Rules / new game modes** | A games team wants its own release cadence | Only after the event contract between "signal" and "reward" is stable |

What must **not** be split without a deliberate saga and the money to pay for it: `ledger` away
from `gamification` and `rewards`. "No duplicate rewards, no negative balance" is one `BEGIN`
today and a two-phase reservation protocol tomorrow. We will pay that price when ledger write
volume forces it, not to satisfy a diagram.

## 7. What is deliberately not built

Stated plainly, because the assignment asks for priorities rather than coverage:

- **No real casino integration.** Two simulated operators with genuinely different schemas,
  including injectable timeouts and failures (`src/mocks/casino-platform`).
- **No frontend.** The player and admin surfaces are HTTP APIs with `docs/samples/` request and
  response pairs.
- **No production infrastructure.** Docker Compose, one Postgres, no Kubernetes, no Terraform.
  [90-days.md](../plan/90-days.md) says when that arrives and in what order.
- **Thin but honest observability.** Structured logs with trace and tenant context, a
  `/health` endpoint, and an append-only audit log. Metrics are named in the plan, not faked
  with a dashboard screenshot.
- **Authentication is API-key + HMAC for operators and a signed player token for the player
  API.** No OAuth, no user management; those belong to the operator.
