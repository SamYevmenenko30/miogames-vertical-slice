# Part E — scaling the product

Answers anchored in what this repository actually does. Where something is not built, it says so
and says what it would cost.

---

## 1. How would you evolve this prototype into a production-ready multi-tenant SaaS?

The prototype is already the right *shape*; what it lacks is operability. In order of what would
hurt first:

**Weeks 1–2 — the things whose absence you discover at the worst moment.**
Managed Postgres with point-in-time recovery and a tested restore (an untested backup is a
belief). Migrations in the deploy pipeline as their own gated step, never at boot — already true
here, and the deploy has to keep it true. Secrets in KMS with independent, rotatable keys per
purpose: today the webhook-secret encryption key is HKDF-derived from the platform secret, which
is sound but not rotatable (TD-0009). Structured logs shipped with the trace id as the join key —
the trace id already exists on every line and every response.

**Weeks 3–5 — the numbers that tell you it is working.**
The metrics in [observability.md](observability.md), starting with `outbox_lag_seconds` and
`ledger_balance_drift`: the first says events are moving, the second can only be non-zero through
a bug (TD-0001). Alerting on the four that mean a customer is affected: ingest acceptance falling
for one operator, outbox lag, redemptions stuck in `issuing` past their lease (the state that can wedge) and in
`pending_issuance`, issuance failures by
operator. Per-operator circuit breaking (TD-0003), so one operator's outage stops consuming
everyone's retry budget.

**Weeks 6–9 — the things a second customer forces.**
Rate limiting on the player API (TD-0005) — correctness already holds because entitlements run
out, but the traffic cost is ours. Roles on the admin surface (TD-0006): today any holder of a
tenant's API credentials can change that tenant's odds, which is fine for one pilot and not for
ten. A reconciliation job for the ledger, and the expiry sweep moved from a cron to a predicate
plus a sweep (TD-0004). Load shedding on ingestion with a durable buffer in front.

**What does NOT need to change**, and this is the part worth saying out loud: the module
boundaries, the transaction model, the idempotency contracts, the isolation layers and the event
contracts are all production shapes already. The work above is operational, not architectural —
which is the whole argument for spending the prototype's time on boundaries rather than on
features.

---

## 2. How would you support 10 casino operators without maintaining 10 separate codebases?

This is the question the architecture was built around, and the answer is already enforced rather
than intended.

**Today, onboarding operator #3 is:** one inbound dialect adapter, one outbound reward adapter,
one line in `integration.module.ts`, one tenant row with its credentials, and its wheel, rule and
store items as configuration. **Nothing** in `gamification`, `ledger`, `rewards` or `ingestion`
changes. That is not a claim about intent: `no-operator-leak.spec.ts` greps the tree and fails if
an operator's name appears outside the integration module, and the boundary lint fails if any
module reaches past another's facade. Both gates caught a real violation in MIO-010, from
opposite ends, when the reward adapters were first put in the wrong module.

**Measured, not asserted.** Before submitting this, I onboarded a third operator to find out what
the claim costs — deliberately unlike the other two: nested objects rather than flat or enveloped,
a unix timestamp in seconds rather than ISO, its own event vocabulary, and an outbound API that
PUTs and reports success in a `state` field. The result, on branch `rehearsal/operator-c`:

| | |
| --- | --- |
| Files touched | **6** — two new adapters, plus the registry line, the simulated operator, the seed tenant row, and one branch in the smoke harness |
| Files touched in `gamification`, `ledger`, `rewards`, `ingestion` | **0** |
| Part B flow | ran end to end for operator C on the first attempt — the smoke run went from 14 asserted steps to 21, including the duplicate-delivery replays |

The branch is kept unmerged, because the assignment asks for two operators and a
third would mean rewriting prose that correctly says "two". What it buys is that
the paragraph above is a measurement rather than a design intention.

It also found a defect, which is why rehearsing beats believing: the guard that keeps operator
names out of the core greps for `casino-(a|b)` — keyed to the operators that exist rather than to
the rule — so operator C's name could have leaked anywhere with the test still green. Fixed on
`main`; it is the third instance of that class in this repository, after the row-level-security
policy census and `arch-check`'s event census.

**At around five operators**, the adapters start to look like each other, and the right move is
to notice *which parts* vary. On the evidence of two, the variation is: field names and nesting,
money units (major-unit decimal strings versus minor-unit integers), the event-type vocabulary,
the reward-kind vocabulary, and the success/reference shape. That is a mapping, not a program.

**At ten**, an adapter becomes configuration: a declarative mapping (field paths, a unit, an
enum translation) validated against the canonical schema, plus a small escape hatch for the one
operator that needs code. The reason not to build that now is honest and specific — with two
operators we would be guessing which parts vary, and a mapping language chosen on two examples
is a mapping language rewritten on the fifth. The canonical event is the thing that makes the
switch cheap whenever we make it, because the core has never seen anything else.

**What stays code, forever:** failure classification. "Is this retryable" is a judgement about
someone else's API semantics, and getting it wrong burns the attempt budget against requests that
can never succeed. That belongs in a reviewed adapter, not in a config row.

---

## 3. How would you introduce PvP, Missions and Kingdom Builder without coupling every feature to the casino integration layer?

They subscribe to domain events; they never meet an operator.

The seam already exists and is already load-bearing. `gamification.spin.completed` is published in
the same transaction as the spin, and **nothing consumes it** — which is exactly why it is there.
A missions module consumes it, keeps its own progress tables, and credits coins through the
`ledger` facade. It needs no knowledge that operators differ, no change to `integration`, and no
change to the deposit path.

Concretely, for each feature:

- **Missions** ("spin five times", "redeem once this week"): consumes
  `gamification.spin.completed` and `rewards.redemption.issued`, owns `missions.*` tables,
  rewards through `ledger.credit` with an idempotency key of `mission:<id>:<playerId>`. No new
  inbound integration at all.
- **PvP** (a leaderboard, then head-to-head): consumes the same spin events for scoring. The one
  genuinely new thing is a *bounded contest* with a close time, which means a scheduled job and a
  payout transaction — and the payout is a ledger credit like any other. PvP's own events
  (`pvp.contest.closed`) let a later feature hang off it in turn.
- **Kingdom Builder** (spend coins on a persistent construction): consumes nothing; it *debits*
  the ledger, exactly as the bonus store does, with its own idempotency keys. It is the clearest
  case: a feature that only spends coins touches one facade.

The three rules that keep this true, each already enforced:

1. A new module may import another only through its facade (lint), and must declare the edge in
   `architecture.yaml` (`arch-check`). A coupling cannot appear without a reviewer seeing it.
2. A synchronous call into another module is allowed only when its result is needed for *your*
   transaction to be correct. "Would the request still be correct if this ran five seconds later?"
   — yes means event. That rule is why missions can be added without touching the spin path.
3. Every consumer is idempotent by construction (the base class and `infra.processed_event`), so
   at-least-once delivery is a non-event for a feature author.

The one thing to watch: event ordering. The relay makes no ordering guarantee, deliberately
(MIO-001 Q1), and today's consumers are commutative. The first feature that needs ordering gets
a per-aggregate claim in the relay — a change to one query — and the constraint is written in the
module's AGENTS.md so nobody assumes otherwise by accident.

---

## 6. Which parts of the development process would you automate using AI?

This repository is the answer, and it is more specific than "use AI to write code" — most of the
code here was written by an agent, and the interesting part is what had to be built around it.

**Automate the work: already done, and it is the easy half.** Specs into failing tests,
implementation to green, schema and adapter boilerplate, the first draft of every document, and
the operator dialects. An agent is very good at all of it. The caveat from doing it: the agent is
*equally* fluent when it is wrong, and a confident wrong answer costs more than a slow right one.

**Automate the verification: this is where the leverage is, and it is the half most teams skip.**
Each of these replaced a human control that does not scale — on a team of six it is the review
bottleneck, on a one-author build it is absent altogether. They were earned on the former and
they are what makes the latter possible:

- `red-check` — every added test must fail at the merge-base, each file alone in a clean
  worktree. This is the single highest-value gate in the repository, because a test written by
  the same mind that wrote the code tends to assert what the code does. Coverage cannot tell the
  difference; a reviewer usually cannot either.
- `spec-gate` — a ticket cannot leave the spec phase with an unanswered question. Unanswered
  questions are where an agent invents a product decision and buries it in an `if`.
- `test-guard` — a test may not be edited without a declared `spec-conflict:`. Bending a test to
  fit the code is the easiest way to turn a spec-first pipeline into theatre.
- `arch-check` and the boundary lint — an architecture that is only described decays in a week
  of agent-speed changes.
- `gate-probes` — plant a violation of each rule and require the gate to go red for the right
  reason. **This found four dead gates on its first run**, including the hexagonal gate, which was
  classifying nothing at all.

**Do not automate: the decisions.** Every entry in [ai/human-decisions.md](ai/human-decisions.md)
is a question where the agent's default would have been defensible and wrong for the business:
tiered versus proportional spin grants, what happens to coins when an operator never issues,
how long an entitlement lives. The pattern is that the agent optimises for the code it can write
and the human has to own the cost the choice creates.

**And the measurement of the gates themselves.** A gate that has never been observed to fail is
indistinguishable from one that passes everything. Probing them is the practice this project
would keep above all the others.
