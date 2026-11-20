# Part D — how AI was used, and why this process rather than another

Most of the code in this repository was written by an AI agent. This document names the tooling,
answers the five things the assignment asks to be shown, and then makes the argument for the
process — with the measurements it rests on, and the cost it carries.

The mechanics of the pipeline are in [docs/process.md](../process.md); the defects it caught are
in [evidence-log.md](evidence-log.md). This page is the *why*.

---

## The tooling, concretely

- **Claude Code** (CLI/desktop), driving **Claude Opus**, with the repository's own
  [AGENTS.md](../../AGENTS.md) as its standing instructions and four phase skills in
  [.claude/skills/](../../.claude/skills/).
- **One session per phase, not one session per ticket.** `spec-harden`, `tests-from-spec` and
  `implement-to-green` ran as separate agent sessions. A session that has designed an
  implementation cannot write an honest test for it: it writes the test its design satisfies.
  Separation is the control, and it is free.
- **Reviews ran as independent agent sessions** with their own git worktrees, started with a brief
  and no access to the implementing conversation — deliberately so the reviewer could not inherit
  the implementer's conclusions. Two rounds, in
  [docs/review/](../review/).
- **The fix round for each review was a third session again**, and the reviewer re-measured the
  fixes rather than reading the diff. When the round-two reviewer was asked to sign off work its
  own session had produced, it declined, in its own words, because that would be "the loop that
  made this round necessary".
- **The human in the loop is one person**: writing the briefs, answering the specs' open
  questions, deciding what to merge, and reading every money path.

What this is *not*: an agent left to run unattended. Every gate below exists because an agent was
not trusted, including about its own tooling.

---

## The five things the assignment asks to be shown

| What | Where it is | Scale |
| --- | --- | --- |
| **Plan implementation** | [docs/specs/](../specs/) — a hardened spec per ticket with individually testable statements, and an `## Open questions` section the next phase is blocked on | 14 specs · **147** numbered statements · **28** recorded questions |
| **Generate or modify code** | `git log` — every ticket is `spec(...)` → `test(...)` → `feat(...)`, each with a `Ticket:` trailer; agent-written commits keep `Co-Authored-By` | 86 commits, all 86 carrying the trailer · 14 merge commits |
| **Create tests** | The `tests-from-spec` phase, in a session that had seen no implementation plan; every test name begins with the `S`-id it proves, so spec → test is a grep | **242** tests in 35 files |
| **Review implementation** | [.claude/skills/review/SKILL.md](../../.claude/skills/review/SKILL.md), and two independent adversarial reviews merged **with their findings intact** rather than summarised | Round 1: 3 blockers, 13 should-fix, 6 nits · Round 2: 4 blockers, 14 should-fix, 7 nits |
| **Identify and fix defects** | [evidence-log.md](evidence-log.md) — what each gate caught and what it would have cost; the board cards carry the findings per ticket; `docs/ai/gate-runs/` holds raw output | 22 declared `spec-conflict:` / `test-fix:` lines, each naming what the test got wrong |

And the artefacts the assignment names directly: **agent instructions** →
[AGENTS.md](../../AGENTS.md) plus one per module; **workflow configurations** →
[.claude/skills/](../../.claude/skills/); **evidence of AI-generated changes** → the commit
trailers and [gate-runs/](gate-runs/).

---

## Where the strength is

Four claims, each with the measurement under it. The argument is not "we used AI well" — it is
that the usual controls on code do not work on code written this fast, and these are the
replacements.

### 1. A claim that a machine does not check decays within days

Agent-speed change breaks documentation faster than anyone updates it, so the architecture is
machine-checked rather than described: the hexagon is `eslint-plugin-boundaries` with
`default: 'disallow'`, the module graph is [architecture.yaml](../architecture/architecture.yaml)
and `pnpm arch-check`, the money rules are database constraints, and the board's own honesty is
`board:check`. **Eleven gates in `pnpm verify`.**

The test of this is not that it sounds right. It is that when the reward adapters were put in the
wrong module, **two independent gates failed from opposite ends** — a grep guarding operator names
and the boundary lint guarding module edges — without knowing about each other. That is a model
doing work.

### 2. A gate nobody has watched fail is indistinguishable from one that passes everything

So each rule has a probe that plants a violation and requires the gate to go red **for the right
reason**, after first proving it goes green on a clean tree. **35 probes.**

On their first run they found **four dead gates**, the hexagonal boundary check among them: it was
classifying nothing at all, while lint passed and every architectural claim in the repository
rested on it. Later rounds found more holes in the same way — `test-guard` blind to a test deleted
or renamed, `red-check` awarding its strongest verdict to runs that never reached an assertion,
the probe harness able to manufacture its own verdict. The suite grew 18 → 35 as each was closed.

This is the practice I would keep above all the others, and it is the one most pipelines are
missing.

### 3. A test written by the mind that wrote the code tends to assert what the code does

`pnpm red-check` checks out the merge-base into a clean worktree and runs **every added test file
alone**, requiring each to fail. Coverage cannot tell a vacuous test from a real one; a reviewer
usually cannot either; running the test without the code can.

Its honest limit is in the script's own header and in [evidence-log.md](evidence-log.md): a file
that *crashes* at the base proves "cannot pass without the branch", not "asserts the right thing".
Early tickets were 24 crash-red verdicts out of 26. A review found that a ticket could therefore
pass on crash-red alone, and now it cannot: it needs one assertion-red file or a declared
`crash-red-accepted:` per path. The limit is still real and is still written down.

### 4. The sharpest result in this repository is what separation of sessions produced

Round one found three blockers. Round two reviewed **the fixes for round one** and found **two
money defects those fixes had introduced** — one that asked an operator to grant a reward twice,
one that refunded coins for a reward that had been issued — each reproduced with a real `SIGKILL`
across two worker containers.

That is the whole argument in one fact. A remedy gets less scrutiny than the defect it fixes,
every time, unless something structural forces otherwise. Thirty hand-written mutants in round one
(20 killed, 10 survived) and seventeen in round two (16 killed) are how the tests themselves were
checked, rather than read.

### 5. The questions an agent would have answered quietly

`spec-gate` refuses to let a ticket leave the spec phase while an `## Open questions` bullet is
unanswered, and the answer records who decided and when. **28 questions across 14 specs.** Three
were product decisions the agent would have answered defensibly and wrongly — tiered versus
proportional spin grants, what a failed issuance owes the player, how long a spin lives — and
those went to the product owner. The rest are marked `(agent default)`, which is a real answer and
is labelled as one in [human-decisions.md](human-decisions.md).

An unanswered question is where an agent invents a product decision and buries it in an `if`. The
gate turns it into a thing that blocks.

---

## What it cost

Three sessions and a spec per ticket is slower per ticket than asking an agent for a feature. It
is faster per *correct* ticket, and it is the only version of this that survives one person's
attention span — but the honest accounting is:

- The process is **one card of sixteen**. The other fifteen are product.
- `pnpm gate-probes` takes minutes, so `review:request` runs it only when the branch touched a
  gate, and CI runs it always.
- Three review and fix rounds over a one-day slice is a high ratio, justified here because the
  reviews kept finding money defects. It would not be justified on a CRUD screen.
- It demands someone who can write the brief and judge the result. It multiplies an engineer; it
  does not substitute for one.

## What I would keep, and what I would drop

At **four engineers**: keep `red-check`, the boundary lint, `spec-gate`'s open questions, and
`gate-probes`. Keep review as a separate session from implementation. Drop the three-session split
per ticket (spec and tests can share a session if the human answers the questions), drop the
per-ticket gate-run archiving, drop the board-as-folders in favour of the team's real tracker.

At **forty**: all of the above, plus the thing this slice does not have and names as missing — a
branch audit that reads a branch's prose against its diff. Two module documents contradicted each
other here about an idempotency idiom, and nothing caught it; I did, by chance, which is precisely
the mechanism this project distrusts.

## Honest limits of this evidence

Listed in full in [evidence-log.md](evidence-log.md#honest-limits-of-this-evidence), and the three
that matter most: `red-check` proves a test fails without the implementation, not that it asserts
the right thing; there is no branch audit, so prose drift is caught only by people; and git
distinguishes *agent from human* but not *which agent* — every commit here carries the same
committer and the same `Co-Authored-By`, which already caused one reviewer to attribute a merge to
the wrong session.

The first of those three is the structural one, and it has a designed answer that is not here:
per-case red-on-base, defect-class mutants, and a specification audit. That answer, the
requirements map beside it, and the parallel-probing method for finding a specification's real
forks before implementation are written up with their costs in
[known-gaps.md](../known-gaps.md) — because a gap with a designed answer is engineering, and one
without is a surprise.
