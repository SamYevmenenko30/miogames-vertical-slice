---
id: MIO-009
title: "rewards: the bonus store and an idempotent redemption"
column: 5-done
type: feature
module: rewards
part: "B, C"
depends_on: [MIO-008]
spec: docs/specs/MIO-009.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pass }
---
# MIO-009 — rewards: the bonus store and an idempotent redemption

## Why now

Step 6 of Part B and the duplicate-redemption case. The debit and the intent must be one transaction; the external call must not be in it.

## Scope

- store_item per tenant (price in coins, reward payload), admin adapter to manage them
- POST /v1/redemptions with a required Idempotency-Key; a replay returns the first redemption and debits once
- debit + redemption(pending_issuance) + outbox in one transaction
- insufficient balance is a 409 problem+json, and the CHECK is still the backstop

## Not in this card

- Talking to the operator — MIO-010.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 10 statements, 2 questions |
| tests-from-spec | 2026-11-20 | `red-check` | PASS |
| implement-to-green | 2026-11-20 | `verify` | PASS — 194 tests |
| review | 2026-11-20 | `review:request` | PASS |

## Review findings

**`import type` silently disabled Nest's dependency injection.** The controller
imported `RedeemUseCase` and `RewardsFacade` as types, which erases the
design-time metadata Nest resolves constructors by. Eight integration suites
failed to even collect, with an error that names no parameter — "Nest can't
resolve dependencies of the RedemptionController (IdentityFacade, ?, Object)" —
which reads like a missing provider and is not. Recorded in the module's
AGENTS.md as the trap it is, because the next person will hit it with the same
confusion.

Worth noting what did NOT go wrong: the idempotency key is scoped to the player
as well as the tenant, so S4 ("the same key from another player is a different
redemption") passed first time. That scoping was a deliberate decision in the
spec rather than something the tests discovered — one player's retry returning
another player's receipt is the kind of bug that only shows up in production
support tickets.
