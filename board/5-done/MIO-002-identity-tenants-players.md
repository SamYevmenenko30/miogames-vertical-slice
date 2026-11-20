---
id: MIO-002
title: "identity: tenants, API credentials, players and the external-id mapping"
column: 5-done
type: feature
module: identity
part: "A, C"
depends_on: [MIO-001]
spec: docs/specs/MIO-002.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pass }
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
| implement-to-green | 2026-11-20 | `verify` | PASS — 67 tests |
| review | 2026-11-20 | `review:request` | PASS — all ten gates |

## Review findings

All ten gates PASS. Two findings, both from doing the work rather than from
reading the diff:

- **test-guard could not see a test bent within its own branch.** The tests named
  a `createForTests` method; the capability is real (the seed script and operator
  onboarding both need it) so the correct name is `provisionTenant`, and renaming
  it meant editing a committed spec test. `git diff base..HEAD` calls that file
  merely "added", because the same branch added it two commits earlier — so the
  edit was invisible to the gate, in exactly the branch shape this pipeline uses.
  Closed, with a probe, and the rename is declared with `spec-conflict:` in the
  implementation commit.
- **A prior read cannot promise one player per operator player.** The first
  version of `create()` read, then inserted. Five concurrent first-sights would
  have produced five players. The unique constraint decides now, and the test
  runs the five concurrent calls.
