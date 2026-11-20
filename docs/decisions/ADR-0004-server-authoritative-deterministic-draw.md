# ADR-0004 — Server-authoritative deterministic draw with commit–reveal

Status: Accepted · Date: 2026-11-20

## Context

The wheel must produce "a deterministic, server-authoritative reward" from "a configured
weighted reward table", and Part C asks how players are prevented from manipulating reward
probabilities or triggering unauthorized spins. This is a regulated-adjacent domain: the
operator's compliance team will eventually ask us to prove an outcome was not chosen after the
fact.

## Decision

The outcome is a pure function:

```
index = weightedPick(config.slices, uniform01(HMAC-SHA256(serverSeed, `${spinId}`)))
```

- `serverSeed` is 32 random bytes generated when the **entitlement is granted**, stored, and its
  SHA-256 hash returned to the client at that moment (**commit**).
- `spinId` is minted by the server when the spin is claimed.
- The wheel **configuration version** is pinned onto the entitlement at grant time. Admin
  configuration changes create a new version; they never update a row in place. A spin granted
  on v3 draws from v3 even if v4 is live.
- After the spin, the response includes the seed (**reveal**), the seed hash, the config version
  and the slice index — so the player or a regulator can recompute the result.
- Nothing from the client is an input. There is no `clientSeed`, no `bet`, no timestamp.

Authorisation of a spin is a separate concern and equally mechanical: a spin requires an
entitlement row that belongs to *this* tenant and *this* player and is still `granted`. There is
no "spin" endpoint that does not consume one.

## Consequences

- Determinism makes the engine testable: the unit tests assert exact outcomes for fixed seeds,
  and a distribution test asserts the weights hold over 100k draws.
- Auditability is a property of the stored row, not of a log line: `(config_version, seed,
  seed_hash, index, prize)` is everything needed to recompute.
- Revealing the seed per spin means a seed is never reused. That is enforced by generating it per
  entitlement and never accepting one from input.
- A compromised server secret does not let a *player* predict anything, because the seed is
  per-entitlement and hidden until after the draw. It would let an insider predict — which is
  why the generation path is one function with no configuration knobs.

## Alternatives rejected

**`Math.random()` at spin time.** Not reproducible, not auditable, and in a dispute we would
have nothing to show.

**Client-supplied seed mixed in (full provably-fair).** The standard casino scheme, and a
reasonable future step. Rejected for now because the assignment asks for *server-authoritative*
and because accepting client input into the outcome function means proving that input cannot be
ground for a favourable outcome. That proof costs more than it buys at this stage.

**Pre-generating the outcome at grant time.** Simpler, but it moves the draw away from the act of
spinning, so an operator-side cancellation or an expired entitlement has already consumed its
prize.
