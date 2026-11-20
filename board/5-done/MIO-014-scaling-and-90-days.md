---
id: MIO-014
title: "Part E: scaling the product, and the first 90 days"
column: 5-done
type: docs
module: docs
part: "E"
depends_on: [MIO-013]
spec: none
spec_waiver: "A documentation card: its statements are prose, and the only checkable claim — that every link resolves and every gate run quoted is real — is checked by the board gate and by the committed gate output."
gates: { spec_gate: waived, red_check: n/a, verify: pass, review: pass }
---
# MIO-014 — Part E: scaling the product, and the first 90 days

## Why now

The six Part E questions deserve answers anchored in what this repository actually does, not generic consulting.

## Scope

- docs/scaling.md: production-readiness path, ten operators without ten codebases, PvP/Missions/Kingdom Builder without touching the integration layer, what to automate with AI
- docs/plan/90-days.md: the first 90 days and the smallest team that delivers an MVP in six months
- docs/ai/: the evidence log, the human-vs-agent split, the gate runs

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| write | 2026-11-20 | `pnpm verify` | PASS |
| evidence | 2026-11-20 | `pnpm gate-probes`, `pnpm smoke` | output committed to `docs/ai/gate-runs/` |

A documentation card, and it waives its spec for the reason the waiver states:
the deliverable is prose, and prose is reviewed rather than asserted. What IS
checkable — that the gate runs it quotes are real — is checked by committing the
raw output next to it.

## Review findings

The evidence log was the hardest thing in this repository to write honestly,
because the temptation is to present a pipeline that worked. It did not, at
first: four of its gates were dead, two of its probes could manufacture their own
verdicts, and the gate that proves tests are real was over-claiming its own
verdict. All of that is in the log, with what each would have cost.

The part I would defend hardest in a technical discussion is the limits section:
`red-check` proves a test fails without the implementation, not that it asserts
the right thing; there is no branch audit here, and its absence let two module
documents contradict each other; the review phase was run by the same person who
implemented. A reader who only sees the wins has been sold something.
