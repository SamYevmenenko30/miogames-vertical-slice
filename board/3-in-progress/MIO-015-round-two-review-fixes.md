---
id: MIO-015
title: "Round-two review: the claim's write-back, the recorded grant, the pools, and three gates that did not bite"
column: 3-in-progress
type: fix
module: rewards
part: "C, D"
depends_on: [MIO-010, MIO-011]
spec: docs/specs/MIO-015.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pending }
---
# MIO-015 — Round-two review fixes

## Why now

The round-one fixes were written by the session that found the round-one defects, so they had no
adversary. A second review by a session that had written neither the code, the first review nor the
fixes found four blockers — two of them money defects the lease itself introduced. Submitting with
a path that grants a reward and refunds the coins is worse than submitting with the wedged
redemption that path replaced.

## Scope

- R2-B2 — the three issuance write-backs become conditional on still holding the claim, and the
  refund and the event become conditional on the write-back
- review S9 — a genuinely unique instance id, because the write-back predicate is worthless without
  one (`issuance-${process.pid}` was observed as pid 25 in two containers at once)
- R2-B1 — the grant request is recorded before the operator is called, so a recovery is
  reconcilable; the three places that called a re-claim *safe* stop saying so
- R2-B3 — `test-guard` handles `D` and `R`, and refuses a committed `.only` or skipped test; a
  probe for each
- R2-B4 — `red-check`'s crash-red declaration becomes per-file, it names the files it cannot
  measure, and its honest-limits block says what `assertion-red` does not prove
- review S1/S2 — the two database pools are closed on shutdown
- review S3/S13 — two prose claims that are false

## Not in this card

- The review's other should-fix items and its nits — the user decides on those separately.
- Red-checking test cases added into an existing spec file (TD-0012): the gap is now printed on
  every run, closing it is a tool.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 17 statements, 2 questions |
| tests-from-spec | 2026-11-20 | `red-check` | PASS |
| implement-to-green | 2026-11-20 | `verify` | PASS |
| review | — | `review:request` | pending |

## Review findings

Filled in by the review phase.
