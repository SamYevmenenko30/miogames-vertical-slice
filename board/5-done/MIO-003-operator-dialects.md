---
id: MIO-003
title: "integration: two operator dialects translated into one canonical deposit event"
column: 5-done
type: feature
module: integration
part: "B, E"
depends_on: [MIO-001]
spec: docs/specs/MIO-003.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pass }
---
# MIO-003 — integration: two operator dialects translated into one canonical deposit event

## Why now

This is the card that decides whether operator #10 costs a day or a sprint. The dialect must be the only thing that varies.

## Scope

- contracts/events: casino.deposit.observed (Zod), Money value object
- inbound adapters: platform A (flat, major units) and platform B (envelope, minor units)
- an operator registry keyed by tenant; no operator name outside this module
- mocks/casino-platform: both operators as a real HTTP service with injectable latency, 5xx and malformed replies

## Not in this card

- The outbound reward API — MIO-010.

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 9 statements, 2 questions |
| tests-from-spec | 2026-11-20 | `red-check` | PASS — 4 files red at the merge-base |
| implement-to-green | 2026-11-20 | `verify` | PASS — 100 tests |
| review | 2026-11-20 | `review:request` | PASS — all ten gates |

## Review findings

All ten gates PASS. One finding, and it is the best one so far because the gate
found it twice:

**The operator-leak scan was vacuous two different ways.** It is the test that
keeps ADR-0002's central claim true — that an operator's name appears only
inside `integration` — and it was proving nothing.

1. It ran `git grep` without `--untracked`, so during the implementation phase it
   searched the index. A leak being introduced right then would not have been
   seen. Fixed; declared with `spec-conflict:`.
2. With that fixed it asserted only an *absence*, which is green at the
   merge-base by construction. `red-check` refused the verdict and said exactly
   that: "it does not need the implementation, so it guards nothing."
3. Adding the other half — "the integration module *does* name both operators" —
   then failed, and revealed that the pattern `casino-(a|b)\b` matches **nothing**:
   git grep's `-E` engine does not implement `\b`. Both original assertions had
   been passing over an empty result set all along.

The lesson generalises and is worth the sentence: a guard test that asserts only
an absence is indistinguishable from a broken one, and has the same cure as a
dead gate — assert that the thing you are guarding actually exists.
