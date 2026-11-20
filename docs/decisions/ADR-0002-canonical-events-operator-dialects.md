# ADR-0002 — One canonical internal event; operator dialects only in adapters

Status: Accepted · Date: 2026-11-20

## Context

Two simulated operators send a successful deposit in different shapes, and expect reward
issuance in different shapes. Platform A is flat REST (`{"event":"deposit.completed","user_id":...,
"amount":"50.00","currency":"EUR"}`); Platform B wraps everything in an envelope with its own
header block and sends amounts in minor units (`{"meta":{...},"payload":{"playerRef":...,
"amountCents":5000}}`). Both must drive the same gamification logic. There will be ten of them.

## Decision

A single canonical internal event — `casino.deposit.observed` — defined in `src/contracts/events`
as a Zod schema. Each operator has an **inbound adapter** that validates its own dialect and
translates to the canonical event, and an **outbound adapter** that implements
`CasinoRewardPort` in its own dialect. Both live in `integration`; no operator's name appears
anywhere else in the codebase, which `pnpm arch-check` can check by grep.

Amounts cross the boundary as a `Money` value object (minor units + currency), so the
"euros or cents" question is answered once, in the adapter, where the dialect is known.

## Consequences

- Onboarding operator #3 is: one inbound adapter, one outbound adapter, one registry entry, one
  tenant row. Zero changes in `gamification`, `ledger` or `rewards`. This is the answer to Part E
  question 2, and it is testable: the same gamification test suite runs against both operators.
- The canonical event is now a contract with versioning obligations. It is a Zod schema in one
  place, and the event name carries `module.entity.verb`.
- An operator whose dialect cannot express something we need (no stable event id, say) is a
  *product* conversation, not an engineering workaround. The adapter is where that pain is
  visible, which is where it belongs.

## Alternatives rejected

**Normalise at the edge with a generic mapping language (JSONata/JMESPath configuration).** This
is where a ten-operator platform should end up, and [scaling.md](../scaling.md) plans it. It is
wrong now: with two operators it hides the mapping from the type system and the tests, and we do
not yet know which parts of the mapping actually vary.

**Let each operator's event reach the rules engine and branch inside it.** The obvious shortcut
and the one that kills the product: every new operator then edits the engine, and nobody can say
what the engine does without reading ten branches.
