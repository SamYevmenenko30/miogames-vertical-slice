---
id: MIO-015
title: "Round-two review: the claim's write-back, the recorded grant, the pools, and three gates that did not bite"
column: 5-done
type: fix
module: rewards
part: "C, D"
depends_on: [MIO-010, MIO-011]
spec: docs/specs/MIO-015.md
gates: { spec_gate: pass, red_check: pass, verify: pass, review: pass }
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
| spec-harden | 2026-11-20 | `spec-gate` | PASS — 17 statements, 2 questions (Q1 answered by Sam) |
| tests-from-spec | 2026-11-20 | `red-check` | PASS — 3 added files, **3 assertion-red** |
| implement-to-green | 2026-11-20 | `verify` | PASS — 242 tests in 35 files (was 228 in 32) |
| implement-to-green | 2026-11-20 | `gate-probes` | PASS — 35 probes, 6 of them new ([output](../../docs/ai/gate-runs/MIO-015-gate-probes.txt)) |
| review | 2026-11-20 | independent re-measurement | PASS — verified in a throwaway worktree, not from this branch's own report: `verify` green on all eleven gates, `gate-probes` 35/35, 242 tests in 35 files. Merged to `main` at `02f1bd9` |

Both runs' output is committed, because the evidence log's own complaint about the earlier tickets
is that their verdicts "are no longer recoverable by anyone":
[`verify`](../../docs/ai/gate-runs/MIO-015-verify.txt) and
[`gate-probes`](../../docs/ai/gate-runs/MIO-015-gate-probes.txt). The probe run was made in a
private worktree at this branch rather than in the shared checkout: another session ran
`git checkout main` there during an earlier attempt, and because `gate-probes` overlays the working
tree, that run measured `main`'s `red-check.mjs` and reported three failures for rules that exist
only here. Nothing was lost but the measurement, and a measurement whose provenance is unclear is
worth re-taking rather than explaining.

## Measured, not asserted

The round-two reviewer's own two probe specs were run before and after, and removed — they are
evidence, not part of this change. Theirs is the stronger measurement, because this session did not
write them.

| | Before | After |
| --- | --- | --- |
| **P2** — a stale lease holder writes its failure over a peer's success | PASSES: `status=failed`, `balance 400 -> 500`, operator granted once. The player kept the reward *and* the coins | **FAILS**: `AssertionError: expected 'issued' to be 'failed'`, and `balance 400 -> 400`. The probe asserts the defect, so its failure is the fix |
| **P1** — a worker dies after the operator granted | PASSES: 3 operator grant calls, `attempts=0`, nothing recorded | **PASSES, deliberately** (Q1): the second grant still happens. `grantRequests` is 2, the status API reports it, the completed issuance is logged for reconciliation |
| **P3** — the connection census | clean, oldest open tx 40 ms against a 600 ms operator | clean, 49 ms. Kept clean |
| `pnpm db:seed` | never returned (reviewer waited 300 s) | **1.7 s** |
| `docker stop worker` | **10.28 s, exit 137** — Docker's grace period exactly, then SIGKILL | **2.23 s, exit 0** |

The two rows a reader has to be able to tell apart, printed from the stored state:

```
CLEAN first attempt:       status=issued  attempts=0  grantRequests=1  grantRequestedAt=set
RECOVERED after a crash:   status=issued  attempts=0  grantRequests=2  grantRequestedAt=set
the reconciliation query returns 1 row(s)
```

## Review findings

The four blockers are closed and the two false prose claims are corrected. What is worth keeping
from doing it:

**The remedy the review suggested does not work on its own, and it said so.** R2-B2's fix is
"require `status = 'issuing' and claimed_by = <me>`", and `claimed_by` was `issuance-${process.pid}`
— which the review had already measured as pid 25 in two containers at once. So the predicate had to
be built on something real first. Per-process would still not have been enough: a single worker that
re-claims a redemption its own earlier attempt is still inside would match its own name, and that
attempt is precisely the one whose write-back must be refused. `claimed_by` is now
`<instance>/<uuid>` — unique per claim, and still naming the worker, which is what the column was
documented to be for.

**The second trap was the one that would have shipped.** Making the three `UPDATE`s conditional and
leaving the refund beside them still pays the player: the row is left alone and the coins come back
anyway. The refund and both events are now inside the write-back's answer. S1 and S2 are the same
race asserted twice on purpose — the row and the money fail independently.

**R2-B1 was not this session's to decide, and the pipeline has a place for that.** Q1, answered by
Sam. The duplicate grant stays, because removing it needs an operator-side guarantee nobody has, and
the ambiguity stops being invisible. `attempts` was deliberately not re-pointed to carry the count
(Q2): three MIO-010 statements are written against it meaning failures, so a second column that
means one thing beat one column that means two.

**Nit N4 stopped being reachable rather than being fixed.** `markFailed` still does not clear
`external_ref`, which is how R2-B2's row ended up `failed` holding a successful reference. It can no
longer get there: an `issued` row is never re-claimed, so an `issuing` row cannot carry a reference.
Clearing it would be the wrong instinct anyway — a record of what we sent is exactly what R2-B1
turns out to be about.

**The gates were the more uncomfortable half.** `test-guard` existed for one failure mode and
guarded the hardest route into it while `git rm` and `git mv` stood open; `red-check`'s newest rule
had been switched off for a whole class of file by the fix that introduced it. Both are probed now,
which is the only claim about a gate worth making.

**And the new probes found a defect in an old probe, which is the argument for having them.**
`board/wip-limit-of-one` sourced its two cards by walking the columns in order, so the first card
ever to sit in `3-in-progress` — this one — became both the source and the destination of its own
move: it was written and then deleted, the WIP violation never happened, and the probe failed with
four "Ticket: MIO-015 names no such card" errors instead. `board/column-drift` three probes above it
already guarded against exactly this. It was invisible while every card lived in `5-done`.

## Not closed, on purpose

`red-check` measures added FILES, so cases added inside an existing spec are still unmeasured — the
route every test of the first fix round came in by. The run now names them and `test-guard` demands
a declaration, but a declaration is a sentence. Closing it needs a tool that extracts added
`it(...)` bodies and runs them at the merge-base, and the hard part is that an added case leans on
the rest of its file: TD-0012, with the cost written down. For a one-day slice, naming the hole
beats half-closing it.

The review's other should-fix items (S5–S8, S10–S12, S14) and its nits are untouched — they are the
user's call, and S9 is in here only because R2-B2 cannot be fixed without it.

## Verified by the author before merging

Measured in a separate worktree at `596c92d`, deliberately not by reading this
branch's own claims: `pnpm verify` green on all eleven gates, `pnpm gate-probes`
35/35, 242 tests in 35 files. The only commit after that one (`eb33fac`) changes
three documentation files and no code, so the measurement stands for the head
that was merged. Re-run on `main` after the merge: the same three results.

The round-two reviewer also re-measured its own blockers on the final commit and
reported P2 failing (no refund of an issued reward) and P1 passing with
`grant_requests = 3` visible in the row — which is the decision, not a leak.

**S4 closed here too**, because it was the author's mess rather than this ticket's:
`pnpm smoke` no longer rewrites `docs/samples/` unless asked. Every successful
`verify` used to leave a dirty tree with fresh uuids, which is a trap for a
pre-push hook and makes the committed samples indistinguishable from the last
run. `pnpm smoke:samples` refreshes them deliberately.
