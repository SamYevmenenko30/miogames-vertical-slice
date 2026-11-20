# Assumptions

Written out because the assignment asks for them, and because an unstated assumption is the most
expensive kind.

## About the product

- **A tenant is a casino operator.** One operator, one tenant, one set of credentials. Operator
  groups running several brands over one platform would need a second partition key; not here
  (MIO-002 Q1, and [scaling.md](scaling.md)).
- **The operator owns the player's identity and real wallet.** We never hold real money, never
  see a card, and know a player only by the operator's identifier for them.
- **Coins are per tenant, non-transferable, and have no cash value to the player.** They are
  earned from spins and spent in the bonus store. They are money-*shaped* — audited, idempotent,
  never negative — because they are exchanged for things that cost the operator money.
- **Reward issuance is at-least-once with an idempotency contract on the operator's side.** We
  send `Idempotency-Key`; we cannot enforce that they honour it. If they do not, a retried
  issuance may grant twice on their side — which is why the retry is bounded, every grant we
  REQUEST is recorded before we make the call, and the status API shows exactly what we sent and
  when. The recording was the half that did not exist: a worker killed after the operator granted
  came back as a clean first-attempt success, so the one attempt nobody could account for was the
  one nothing had written down. `grant_requests > 1` is now the list to reconcile (TD-0011).
- **A deposit grants spins by tier**, the highest matching threshold only, decided by the product
  owner (Sam, 2026-11-20). An unused spin lives seven days.
- **A failed issuance refunds in full** (same decision), so a player never pays for our failure or
  the operator's.
- **`free_spins` and `bonus_cash` wheel prizes are recorded, not issued.** Only *store*
  redemptions go out to the operator in this slice. A wheel prize that needs issuing is the same
  mechanism pointed at a different trigger, and it is named in the 90-day plan rather than half
  built.

## About the environment

- **Postgres is available and is the only datastore.** No broker, no cache, no object store.
- **TLS terminates in front of the API.** The HMAC protects the body's integrity and replay
  window; it is not a substitute for transport security.
- **One currency per rule, and the supported set is EUR, USD, GBP.** An unsupported currency is
  refused at the edge rather than converted — conversion is a product decision with a rate source
  behind it.
- **Clock skew between us and an operator is bounded by `HMAC_TOLERANCE_SECONDS`** (five minutes).
  Nothing we decide depends on the operator's clock.

## About what the reviewer sees

- **Two simulated operators, not real integrations**, with genuinely different schemas on both
  sides and injectable latency, failures and malformed answers.
- **No frontend.** The player and admin surfaces are HTTP APIs; `docs/samples/` holds real
  captured request and response pairs from `pnpm smoke`.
- **No production infrastructure.** Docker Compose, one Postgres, no Kubernetes, no Terraform,
  no metrics backend. [observability.md](observability.md) names the metrics that would exist and
  [plan/90-days.md](plan/90-days.md) says in which week.
