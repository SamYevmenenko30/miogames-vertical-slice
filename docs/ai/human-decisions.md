# Which decisions were mine

The assignment asks which decisions I made myself. The useful answer is not a list of everything
I touched — it is the list of questions where **the agent's default would have been defensible
and wrong**, because that is where a human is actually required.

Every spec in [docs/specs/](../specs/) carries an `## Open questions` section, and `pnpm
spec-gate` refuses to let a ticket leave the spec phase while one is unanswered. Each answer
records who decided it and when. That mechanism is the point: an unanswered question is where an
agent invents a product decision and buries it in an `if`.

## Product decisions I was asked for, and answered

| Question | The agent's instinct | What I decided, and why |
| --- | --- | --- |
| **How does a deposit become spins?** (MIO-005) | Proportional — one spin per €25 — because it is a nicer function | **Tiered**: the highest matching threshold, one rule per deposit. Proportional needs a per-event cap and makes the cost of a promotion unpredictable, which is a commercial property, not a code preference |
| **An operator never issues the reward after every retry. What happens to the coins?** (MIO-010) | Keep them debited; the status says `failed` | **Refund in full**, as a compensating credit keyed `redemption:<id>:refund`. A player must not pay for our failure or the operator's. This also set the shape of the failure path: terminal failures refund too |
| **How long does an unused spin live?** (MIO-005) | Thirty days, as the friendlier default | **Seven days.** It creates urgency, and it bounds how long we must keep old wheel configurations reachable — an entitlement pins its wheel version, so a long TTL is a long tail of live configurations |

Three questions, three decisions that changed the design rather than its wording. The agent's
answer to each was reasonable; none of them was mine to delegate.

## Engineering decisions I made and the agent implemented

Not "open questions" — I did not ask, I decided, and the agent built to them:

- **The module boundaries**, and specifically which split is forbidden: `ledger` must not leave
  the monolith without a deliberate saga, because "no duplicate rewards, no negative balance" is
  one `BEGIN` today ([ADR-0001](../decisions/ADR-0001-modular-monolith-first.md)).
- **Money invariants live in the database.** `CHECK (coins >= 0)` is the rule; the application's
  balance read exists only to produce a friendly 422. An agent writes `if (balance < price)
  throw` and it is correct in a unit test and wrong under two concurrent requests
  ([ADR-0005](../decisions/ADR-0005-ledger-invariants-in-the-database.md)).
- **Commit–reveal for the draw.** Server-authoritative was in the brief; committing the seed hash
  at grant time and revealing the seed after the spin was not, and it is what makes the outcome
  checkable by someone who does not trust us ([ADR-0004](../decisions/ADR-0004-server-authoritative-deterministic-draw.md)).
- **Configuration is versioned, never updated in place**, so an in-flight entitlement keeps the
  odds it was granted under.
- **`404`, never `403`, for another tenant's resource.** A 403 confirms the id exists.
- **The gates would be probed.** `pnpm gate-probes` exists because of a previous project where
  three gates had been dead for weeks. It found four dead gates here on its first run, which is
  the most load-bearing decision in this repository.
- **What is deliberately not built**, and that it would be written down rather than implied:
  [assumptions.md](../assumptions.md) and [tech-debt.md](../tech-debt.md).

## Decisions the agent made, which I let stand

Recorded for honesty, since "the agent decided" is a real answer and pretending otherwise would
make the rest of this document less credible. Each is marked `(agent default)` in its spec:

- No ordering guarantee from the outbox relay, with the constraint written into the module's
  AGENTS.md so a later feature cannot assume otherwise by accident (MIO-001 Q1).
- A failed outbox row retries forever with capped backoff rather than being dead-lettered —
  dropping a domain event silently is worse than a queue that visibly grows (MIO-001 Q2).
- An event with no operator event id is refused rather than given a synthesised one, because a
  synthesised id makes two different deposits collide and swallows one (MIO-003 Q1).
- A rule naming an unconfigured wheel throws, so the outbox retries and records the error, rather
  than granting a spin with no odds behind it (MIO-005 Q1).
- An operator answering `200` with no reference is a **terminal** failure: a success we cannot
  record is not a success (MIO-010 Q1).
- One tenant per operator, no brands (MIO-002 Q1); the trace id is not accepted from the caller
  (MIO-012 Q1); the smoke run creates its own database (MIO-013 Q2).

The pattern across all of them: the agent is good at deciding what the *code* should do when
the business has no stake in the answer, and reliably optimistic about questions where the
business pays for being wrong.
