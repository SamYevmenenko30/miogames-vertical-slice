---
id: MIO-013
title: "An end-to-end smoke run and the sample requests and responses"
column: 5-done
type: chore
module: tooling
part: "B"
depends_on: [MIO-011, MIO-012]
spec: docs/specs/MIO-013.md
gates: { spec_gate: pass, red_check: n/a, verify: pass, review: pass }
---
# MIO-013 — An end-to-end smoke run and the sample requests and responses

## Why now

A reviewer should be able to see all eight Part B steps happen on their own machine in under a minute, for both operators.

## Scope

- pnpm smoke: deposit -> entitlement -> spin -> coins -> redemption -> issuance -> status, printing each step
- the same run against operator B, whose dialect differs at both ends
- docs/samples/*.http with real captured requests and responses
- README: setup, assumptions, what is deliberately not built

## Phase log

| Phase | When | Gate | Result |
| --- | --- | --- | --- |
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 6 statements, 2 questions |
| tests-from-spec | 2026-11-20 | `red-check` | n/a — the script IS the test; it asserts and exits non-zero, and `pnpm verify` and CI both run it |
| implement-to-green | 2026-11-20 | `verify` | PASS — 221 tests + 14 asserted smoke steps |
| review | 2026-11-20 | `review:request` | PASS |

## Review findings

Two things in this card are worth a reviewer's attention, and one of them is an
admission.

**The run tops up coins when the wheel pays less than the item costs.** The
wheel is weighted — 45% of spins pay 10 coins — so a run of two spins can
legitimately end below the 100-coin item price. The script says so on the
console, credits the difference through the ledger with its own idempotency key,
and continues. The alternative was a wheel rigged to pay enough, which would
have made the smoke run a demo rather than a measurement. It is visible in the
output, which is the point.

**This card adds no `*.spec.ts`, and `red-check` therefore has nothing to say
about it.** The script asserts every statement itself and exits non-zero on the
first failure; wrapping it in vitest would move the assertions somewhere less
readable and prove nothing extra. The honest consequence is that this card's
proof rests on `pnpm verify` and CI running it, which they both now do — and the
card records that the usual gate did not apply rather than claiming it passed.

The samples in `docs/samples/part-b-flow.http.md` are captured from the run with
secrets redacted, including the duplicate-delivery answers. A hand-written sample
is a claim; a captured one is evidence.
