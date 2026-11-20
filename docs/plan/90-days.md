# Part E — the first 90 days, and the smallest team that can do it

## 5. The smallest realistic team for an MVP in six months

**Four engineers plus a product owner who answers questions in hours, not weeks.**

| Role | Why this one and not another |
| --- | --- |
| **Tech lead / backend** (1) | Owns the boundaries, the money invariants and the review bar. The one role that cannot be part-time: every decision in this repository that would have been expensive to get wrong was a boundary decision. |
| **Backend** (2) | One on the gamification side (rules, wheels, spins, new game modes), one on the integration side (operator adapters, issuance, the reliability work). Splitting it this way means operator onboarding never blocks feature work, which is the bottleneck a gamification vendor actually hits. |
| **Platform / DevOps** (1, from month two) | Deploys, Postgres, secrets, observability, the CI the rest of the team leans on. Before month two there is nothing to operate; after month three its absence is the thing slowing everyone down. |
| **Product owner** (not an engineer) | The decisions in [ai/human-decisions.md](../ai/human-decisions.md) are the shape of this job: tiering versus proportional grants, refund policy, TTLs, what a failed issuance owes a player. An engineer guessing these builds the wrong product correctly. |

**Not in the four, deliberately:** a frontend engineer (the operator embeds our APIs; a player
UI is their surface in this model, and if we own one it is month five), a QA engineer (the gates
are the regression suite; a QA engineer added at month six does exploratory work the gates
cannot), and a data engineer (the events are already published; analytics is a consumer, and it
is a month-seven conversation).

**With AI assistance throughout**, which is the honest caveat on "four": this slice — six modules,
221 tests, ten gates, the documents — was built by one person and an agent in a day. The gates
are not a one-day artefact themselves: they are a distillation of a method already working in
production on a live product. The four are
not four pairs of hands; they are four people who can each *decide*, with an agent doing the
typing. The constraint that does not change is review capacity: somebody has to understand every
boundary and every money path, and that does not parallelise.

## 4. What the first 90 days look like

Each fortnight ends with something a customer could use or an operator could sign off. The
sequencing is driven by one rule: **the first operator in production teaches you more than three
months of design**.

### Days 1–14 — one operator, in production, carrying real events

Deploy the slice as it is: managed Postgres with a tested restore, migrations as a gated deploy
step, secrets in KMS with per-purpose keys (closing TD-0009), logs shipped. Onboard operator #1
in *shadow* mode — real deposit events, spins and coins, rewards issued to their sandbox. Nothing
of the architecture changes; the work is operability.

*Done when:* a real deposit from operator #1's staging makes a real spin, and we can answer "what
happened to redemption X" from stored rows.

### Days 15–28 — the numbers, and the first operator live

The metrics in [observability.md](../observability.md) with alerts on the four that mean a customer
is affected. Per-operator circuit breaking (TD-0003) and the ledger reconciliation job
(TD-0001) — in that order, because the first prevents an incident and the second detects one.
Operator #1 live with real players, on a small share of traffic.

*Done when:* an operator outage is visible on a dashboard before they tell us, and the retry
budget of everyone else is unaffected by it.

### Days 29–42 — the second operator, as a test of the claim

Onboard operator #2 end to end and **measure the onboarding**: how long, how many files, what
surprised us. The target is a week; the architecture says it should be two days of adapter work
plus configuration. If it takes three weeks, that is the most valuable finding of the quarter and
the mapping-driven adapter work of question 2 starts immediately instead of at operator five.

Admin roles (TD-0006) land here, because two operators mean two sets of people who should not
share one credential.

*Done when:* two operators are live and we know, from measurement rather than from the diagram,
what onboarding actually costs.

### Days 43–56 — the first new game mode, as a test of the other claim

Missions, built as a module that consumes `gamification.spin.completed` and touches neither
`integration` nor the deposit path. This is question 3's answer under test: if a missions module
needs a change in the integration layer, the event seam is not where we think it is, and we would
rather learn that in week eight than in month six.

Rate limiting on the player API (TD-0005) ships alongside, since missions make players spin more.

*Done when:* a feature shipped without touching the integration layer, and the diff proves it.

### Days 57–70 — scale and the boring things

Load test ingestion to ten times operator #1's peak; put a durable buffer in front if it needs
one. Partition the ledger entry table if volume says so. Expiry as a predicate plus a sweep
(TD-0004). W3C trace context in from operators. The compliance conversation about audit retention
(MIO-012 Q2) starts here, because it has a lead time measured in months.

*Done when:* a tenfold traffic spike is a graph, not an incident.

### Days 71–90 — operators three to five, and the mapping decision

Onboard three more operators using whatever the day-29 measurement taught us. By now there is
real evidence about what varies between dialects, which is the only sound basis for the
configuration-driven adapter work. Decide it here, with five examples, instead of guessing with
two.

*Done when:* five operators live, and the sixth is a known quantity rather than an estimate.

## What I would refuse to do in the first 90 days

- **Split the ledger out of the monolith.** The money invariants are one `BEGIN` today and a
  two-phase reservation protocol tomorrow. Nothing in these 90 days justifies that cost.
- **Build PvP or Kingdom Builder before Missions.** Missions is the cheapest possible test of the
  event seam. Learn the seam on the cheap feature.
- **Write the operator mapping language.** Question 2 explains why: with two operators we would
  be guessing which parts vary.
- **Hire a fifth engineer before the platform engineer.** More hands on an unoperable system
  makes a slower system.
