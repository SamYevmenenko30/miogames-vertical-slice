---
id: MIO-000
title: "The pipeline: spec-first phases, the gate set, and probes that prove the gates bite"
column: 5-done
type: chore
module: tooling
part: "D"
depends_on: []
spec: none
spec_waiver: "This card builds the gate set itself; its correctness criterion is gate-probes, not a behaviour spec. Every card after it is gated on having one."
gates: { spec_gate: n/a, red_check: n/a, verify: pass, review: self }
---
# MIO-000 — The pipeline: spec-first phases, the gate set, and probes that prove the gates bite

## Why now

Everything after this card is written mostly by an agent. The gates are what make that safe, so they come first — and a gate nobody has watched fail is not a gate, hence the probes.

## Scope

- scripts/: verify, spec-gate, red-check, test-guard, arch-check, board, review-request, gate-probes
- .claude/skills/: the four phase skills the agent is actually run with
- board/ columns + this card set; CI running the same gates

## Not in this card

- No code in src/ — this card builds the machine, not the product.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| build | 2026-11-20 | `pnpm lint`, `pnpm typecheck` | PASS |
| probes | 2026-11-20 | `pnpm gate-probes` | PASS — 18/18, output in `docs/ai/gate-runs/MIO-000-gate-probes.txt` |

This card has no spec and no red tests, and that is deliberate: it builds the
machine that will demand both of every card after it. Its own correctness
criterion is `gate-probes` — each of the eighteen rules must go red on a planted
violation and green on a clean tree.

## Review findings

Reviewed by the probes rather than by reading, which is the point. The first run
found **four dead gates**, all of them invisible in the code:

1. **The hexagonal gate was not running at all.** `boundaries/elements` used file
   patterns (`src/modules/*/index.ts`), which v7 classifies as nothing — and the
   plugin's warning about it reads like a style note. Compounded by a missing
   TypeScript resolver, without which every relative import resolves to
   "unknown" and every policy matches nothing. Both fixed; the four boundary
   probes now fail correctly.
2. **`export … from` was not a dependency**, so a facade could re-export an
   adapter and make the module's public surface its implementation.
3. **`spec-gate` could not see the last section of a file**, because its section
   regex used `\Z`, which JavaScript does not have. A spec with exactly one
   unanswered open question passed the gate.
4. **`arch-check` missed every relative cross-module import** — it matched
   `modules/<name>` in the import string, and real imports read `../../ledger`.

None of these would have been found by reading the diff, and three of them would
have left the pipeline looking green while enforcing nothing. That is the whole
argument for probing gates, written down in
[ADR-0007](../../docs/decisions/ADR-0007-spec-first-pipeline-for-ai-agents.md).
