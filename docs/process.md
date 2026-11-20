# Process — the pipeline this repository is built with

One person and an AI agent built this. The process exists because the usual controls (a second
pair of eyes, a slow review, institutional memory) are the controls a solo AI-assisted build does
not have. Each one is replaced with something a machine can check.

## The three phases

Every ticket passes through three **separate agent sessions**. Separate is the point: a session
that has already designed the implementation cannot write an honest test for it, because it will
write the test that its plan satisfies.

```
   board/0-backlog
        │
        ▼  spec-harden  (session 1)
   docs/specs/MIO-XXX.md  ── S1..Sn, ## Open questions
        │   gate: pnpm spec-gate MIO-XXX   (no unanswered question may pass)
        ▼  tests-from-spec  (session 2 — has never seen an implementation plan)
   *.spec.ts referencing S-ids, all failing
        │   gate: pnpm red-check   (each added test file must fail at the merge-base)
        ▼  implement-to-green  (session 3 — spec tests are read-only)
   code until the suite is green
        │   gates: pnpm verify, pnpm test-guard, pnpm arch-check
        ▼  review
   board/5-done + the review block in the card
```

### Phase 1 — spec-harden

Input: a card in `board/0-backlog`. Output: `docs/specs/MIO-XXX.md` whose behaviour section is a
numbered list of individually testable statements:

```
- **S4 — a replayed deposit event causes no second entitlement.** Posting the same
  operator event id twice returns 200 with the original event id, and the player has
  exactly the entitlements of the first delivery.
```

The spec also carries `## Open questions`. An unanswered question is the single highest-value
artifact in this pipeline, because it is exactly where an agent would otherwise invent a product
decision and bury it in code. `pnpm spec-gate` fails while a question is unanswered, and the
answer is recorded with who decided it.

### Phase 2 — tests-from-spec

A fresh session reads the spec and writes failing tests. Rules:

- every test name begins with the `S`-id it proves, so `spec → test` is a grep;
- no implementation, no stubs that make the test pass, no `it.todo`;
- a statement that cannot be tested yet is reported back as a spec defect, not skipped.

Then the gate that makes this phase worth anything:

**`pnpm red-check`** — for every test file this branch adds, check out the merge-base into a
clean worktree, stage *only that file*, run it, and require it to fail. Each file separately, so
one red file cannot mask a green sibling behind an aggregate exit code. The gate distinguishes:

- **assertion-red** — the test ran and its expectation failed. The strong result.
- **crash-red** — the test could not even import the code the branch adds. Counts as red (it
  cannot pass without the branch) but proves less, and the gate says so.
- **cannot verify** — the runner could not execute the file. This **fails the gate**; it is never
  counted as red.

### Phase 3 — implement-to-green

Code until the tests pass. The spec tests are read-only. If one is wrong, the session stops and
commits `spec-conflict: S7 — the spec requires 403 where tenant isolation requires 404`, which
sends the ticket back to phase 1. `pnpm test-guard` compares the test files against their state
at the merge-base and fails any modification without such a commit on the branch.

## The gate set

| Gate | Question it answers | Fails when |
| --- | --- | --- |
| `spec-gate` | Is there a spec, with testable statements and no open question? | A question is unanswered, an `S`-id is duplicated, the card is missing |
| `red-check` | Do the new tests actually test something? | A new test file passes at the merge-base, or cannot be run |
| `test-guard` | Was a test bent to fit the code? | A pre-existing spec test changed without a `spec-conflict:` commit |
| `arch-check` | Does the architecture still match its model? | An undeclared cross-module import, a missing ring, a module with no isolation test |
| `lint` (boundaries) | Did a ring or a module boundary get crossed? | A domain file imports Nest/Drizzle; a deep import into another module |
| `board:check` | Is the board honest? | Card front-matter column ≠ folder, more than one card in progress, a commit trailer naming a card that does not exist |
| `docs-links` | Do the documents' cross-references resolve? | A relative markdown link points at a file that does not exist |
| `verify` | Everything above, plus typecheck, tests and build | Any of them |
| `gate-probes` | **Do the gates work at all?** | A planted violation does *not* turn its gate red |

`gate-probes` is the one most pipelines are missing. A gate that has never been observed to fail
is indistinguishable from a gate that silently passes everything, and in a previous project three
of ours had been dead for weeks. Each probe plants a known-bad change in a scratch worktree, runs
the gate, and asserts a non-zero exit with the expected message.

## The board

`board/<column>/MIO-XXX-slug.md`. Columns are folders:

```
0-backlog  1-in-spec  2-in-tests  3-in-progress  4-in-review  5-done
```

Moving a card is `git mv`, so the board's history *is* the repository's history — `git log
--follow board/5-done/MIO-004-wheel-draw.md` shows when that work was specced, tested and
finished. Each card carries front-matter (`id`, `title`, `column`, `type`, `depends_on`, `spec`,
`gates`) and the review findings. `pnpm board` prints the board; `pnpm board:check` enforces that
the front-matter agrees with the folder and that **at most one card is in `3-in-progress`** — a
work-in-progress limit of one, which for a single agent is the difference between a finished
ticket and three half-finished ones.

## What the agent decided and what I decided

Recorded per ticket in [ai/evidence-log.md](ai/evidence-log.md) and summarised in
[ai/human-decisions.md](ai/human-decisions.md). The short version of the division:

- **Mine**: the module boundaries and what must not be split; the invariants that became database
  constraints; commit–reveal for the draw; `404`-not-`403`; what is deliberately not built; every
  answer to an `## Open questions` bullet.
- **The agent's**: nearly all of the code and tests, the Drizzle schemas, the retry/backoff
  mechanics, the fake operator dialects, and the first draft of every document here — including
  this one, which I then cut by half.
- **How I verified it**: the gates above, plus the one thing a gate cannot do — reading the
  specs' open questions and answering them myself.
