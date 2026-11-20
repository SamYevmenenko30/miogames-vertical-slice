---
id: MIO-005
title: "gamification: reward rules turn a deposit into spin entitlements"
column: 5-done
type: feature
module: gamification
part: "B, C"
depends_on: [MIO-004, MIO-006]
spec: docs/specs/MIO-005.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pass }
---
# MIO-005 — gamification: reward rules turn a deposit into spin entitlements

## Why now

Step 3 of Part B. Rules are data so a new rule is a row; the rule evaluation is pure so it is testable without a database.

## Scope

- reward_rule per tenant (min deposit, currency, spins granted, wheel, TTL)
- a pure domain function: (deposit, rules) -> grants
- consumer of casino.deposit.observed, idempotent on processed_event
- spin_entitlement rows pinned to a wheel version, each with a committed server seed (hash stored, seed hidden)

## Not in this card

- Spending an entitlement — MIO-007.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 9 statements; tiers and TTL decided by Sam |
| tests-from-spec | 2026-11-20 | `red-check` | PASS |
| implement-to-green | 2026-11-20 | `verify` | PASS — 166 tests |
| review | 2026-11-20 | `review:request` | PASS |

## Review findings

No defects. Two decisions worth recording because they came from Sam, not from
the agent, and they changed the design rather than the wording:

- **Tiered rules, one rule per deposit.** The agent's first instinct was
  proportional granting (one spin per €25), which needs a per-event cap and makes
  the cost of a promotion unpredictable. That is a product property, and the
  product owner answered it.
- **A seven-day TTL.** Shorter creates urgency and bounds how long we hold old
  wheel versions alive; the alternative (never expiring) would keep every
  historical configuration reachable forever.

One agent decision worth a second look in review: a rule naming an unconfigured
wheel **throws**, so the outbox retries and records the error, rather than
granting a spin with no odds behind it. A test pins that behaviour, because the
tempting alternative — skip the grant and move on — loses a player's reward
silently.
