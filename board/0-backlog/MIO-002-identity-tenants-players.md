---
id: MIO-002
title: "identity: tenants, API credentials, players and the external-id mapping"
column: 0-backlog
type: feature
module: identity
part: "A, C"
depends_on: [MIO-001]
spec: docs/specs/MIO-002.md
gates: { spec_gate: pending, red_check: pending, verify: pending, review: pending }
---
# MIO-002 — identity: tenants, API credentials, players and the external-id mapping

## Why now

Nothing else can be scoped to a tenant until a tenant exists, and no event can name a player until the mapping does.

## Scope

- tenant + tenant_api_key (hashed secret, key id in the clear)
- player + player_identity with UNIQUE (tenant_id, external_player_id)
- provisioning on first authenticated event; never from client input
- facade: resolveTenantByKeyId, verifyKey, ensurePlayer, findPlayer

## Not in this card

- Player-facing session tokens — minted here, consumed in MIO-007.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | — | `spec-gate` | — |
| tests-from-spec | — | `red-check` | — |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
