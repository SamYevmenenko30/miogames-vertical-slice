---
id: MIO-002
title: "identity: tenants, API credentials, players and the external-id mapping"
column: 2-in-tests
type: feature
module: identity
part: "A, C"
depends_on: [MIO-001]
spec: docs/specs/MIO-002.md
gates: { spec_gate: pass, red_check: pass, verify: pending, review: pending }
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
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 12 statements, 2 questions |
| tests-from-spec | 2026-11-20 | `red-check` | PASS — 3 files red at the merge-base |
| implement-to-green | — | `verify` | — |
| review | — | `review:request` | — |

## Review findings

_Filled in during review. A finding that is not fixed becomes a line in `docs/tech-debt.md`._
