# Known gaps with designed answers

A gap with a designed answer is engineering. A gap without one is a surprise waiting for
production. Everything in [tech-debt.md](tech-debt.md) is the first kind at the scale of a day or
two of work. This file is for the three that are bigger than that, that this slice genuinely does
**not** have, and that I can describe precisely enough to cost — because the hardest thing to
judge about a pipeline is not what it catches, but what it is structurally unable to catch.

All three are about the same blind spot. The gates here prove that a test **depends on** the
branch's code. None of them proves that the test **means** what its specification says it means.

| Gap | What the gates cannot see | Designed answer | Cost |
| --- | --- | --- | --- |
| 1 | A test can cite `S14` and assert nothing about `S14` | Per-case red-on-base, defect-class mutants, then a specification audit | 2–3 days for the first layer, a fortnight for the second |
| 2 | No program joins an `S`-id to the test that cites it | The specification as a machine-readable map, gated on presence and ownership | 3–4 days |
| 3 | A specification's real forks are invisible until implementation | Parallel probing of one spec from one base, reinforcing routes that reach green | ~2 weeks of harness before the first honest run |

---

## 1. An `S`-id proves citation, not relevance

### The problem, measured here

Fourteen specifications carry 147 numbered assertions; 242 tests in 35 files cite them in their
`it(...)` titles. That citation is a **convention** carrying almost no weight: `spec-gate` reads
the ids far enough to require that a specification declare numbered statements and that their ids
be unique, and nothing anywhere reads the id in a test's title. The two halves are never joined.
The gates around them are each one step short:

- `red-check` proves a new test fails at the merge-base. It accepts **crash-red** — a test that
  errored before reaching an assertion — because a suite that cannot even load without the branch
  is still evidence of dependence; it now requires each such file to be declared, which makes the
  weakness visible rather than absent. And an `assertion-red` verdict proves only that *some*
  assertion ran and failed: a test asserting a file's source text, or one throwing its own
  `AssertionError`, earns the gate's strongest verdict while observing no behaviour. Measured in
  round two of the review, with a deliberately broken implementation and three worthless tests
  passing every gate.
- `test-guard` requires a declaration (`spec-conflict:` or `test-fix:`) when a test changes. A
  declaration is a sentence from the author; it measures nothing.
- `verify` runs the suite. A suite that asserts the wrong thing is green.

This is not hypothetical here, and the demonstrations are in the repository:

- The **only** test for "two workers cannot both issue the same reward" asserted the final status
  of the redemption instead of counting calls at the operator, so it held on a money path while
  proving nothing (round one, B2). The fix made the claim assertable — the simulated operator now
  counts the grants it is asked for — and the mechanism is recorded in
  [`src/mocks/casino-platform/app.ts`](../src/mocks/casino-platform/app.ts).
- A mutant that deleted `FOR UPDATE` from the balance read left **221 of 221 tests green** (round
  one, S4). The concurrency test named as its proof passes without the lock, because the loser is
  then rejected by the `CHECK` constraint instead — and the test asserted only that it was
  rejected, never why.

Both were found by deleting the mechanism by hand and re-running — which is layer 2 below,
performed manually. It changed the verdict both times, and in round two the same technique
confirmed the repaired test: the mutant that deletes the claim's status predicate kills that test
and only that test, 1 failed of 228. A technique that reliable, used by hand, is a gate that has
not been built yet.

### The designed answer — three layers, in the order they pay off

**Layer 1 — a verdict per test case, not per test file.** `red-check` today collects the spec
*files* a branch adds, which is why a case added into an existing file escapes it entirely
([TD-0012](tech-debt.md)). The design extends the unit from file to case: extract the `it(...)`
bodies a branch adds, moves, modifies or deletes, synthesise a file at the merge-base carrying the
original module scope plus only those cases, and give each case its own verdict — `assertion-red`,
`crash-red`, `cannot-compare`, with a reason word per file for the states where comparison is
impossible (a case that moved between files, a hook that fails to load). Money-critical modules
then raise the bar from "red" to "assertion-red": an errored test is not a proof there.

The parsing is the easy half. The hard half is scope sharing — an added case usually leans on a
`beforeEach` and helpers from the rest of its file, so the synthesised file has to carry the whole
module scope and none of the sibling cases, and getting that wrong fails correct work closed. That
is why it is two or three days rather than an afternoon.

**Layer 2 — defect-class mutants.** For each `S`-id, name the mechanism the assertion is about
(a guard clause, a `FOR UPDATE`, a uniqueness constraint, an idempotency key), delete or invert
exactly that, and require that the tests citing that `S`-id — and preferably *only* those — go
red. This is narrow, deterministic mutation testing driven off the specification rather than off
the syntax tree, and it is the only mechanical answer to "does this test assert what it claims".
A broad mutation run (Stryker-style, report-only, scoped to changed files) sits beside it as the
net for everything no `S`-id named; broad mutation is too slow and too noisy to gate on, and
report-only is the honest setting until a team has a baseline.

The reason this is a *fortnight* and not a weekend: a mutant runner needs a harness that can build
and run the suite against a patched tree repeatedly and in isolation — a clone and a database per
mutant — and a scheduler, because the naive version re-runs everything for every mutant. Without
that isolation the result is a flake report, not a mutation report.

**Layer 3 — a spec audit.** The two layers above still cannot read English. The third layer is a
reviewing agent, run like the branch audit this repository also lacks: for each `S`-id, a row
naming the test, the mechanism, and the one question that matters — *would this test fail if the
outcome were inverted?* Advisory at first, because an LLM verdict is evidence, not a gate, until
its false-positive rate has been measured over a few dozen pull requests.

### Why it is not here

Layers 1 and 2 are each larger than any single card on this board, and layer 2's harness — clone
and database per mutant — is the same infrastructure a controlled-interleaving test runner needs,
which makes it a project rather than a task. In a one-day slice with 147 assertions and one
author, the adversarial review sessions were the cheaper instrument, and they worked: the sharpest
finding in this repository (two money defects introduced *by the first round's fixes*) came from a
review, not a gate. That is a true result and a fragile one — it is a measurement of attention,
and attention does not scale, which is the whole argument for layers 1 and 2.

---

## 2. The requirements map

### The problem

A specification here is prose with numbered assertions, and the only thing connecting it to the
code is a string in a test title that no program reads. Worse, that string is **ambiguous by
construction**: statement ids restart at `S1` in every specification, so the 14 of them share 51
distinct ids between 147 statements, and of the 250 `Sn` citations in the test files exactly
**three** name their specification (`MIO-008 S7`); the other 247 are a bare `S9` that four
different specifications also use. A program asked "which assertion is this test for?" could not
answer from the title even if something read it. Consequently nothing can answer, at any moment,
the questions a reviewer actually has:

- Does **every** assertion have at least one test? (Here: unanswerable, per the paragraph above
  — a global match says yes and means nothing.)
- Does that test live in the module the assertion is about, or did it land in whatever suite was
  convenient?
- Is there a test citing an assertion number that **no longer exists** — a leftover from a
  renumbered revision?
- Which assertions does a given diff put at risk?

`spec-gate` looks inside only far enough to see that numbered statements exist and that no id
repeats *within one file*; `board:check` checks that every card in progress has a specification at
all. Neither crosses from the specification to a test.

### The designed answer

Make the specification a graph and generate it, rather than maintaining it. Each assertion becomes
a node carrying the module it constrains, the tests that cite it, and — once per-case coverage is
available — the lines those tests actually executed. Three gates sit on the result: **presence**
(every assertion has a citing test, failing closed, with an explicit waiver syntax for the ones
deliberately left to a later card), **ownership** (the citing test lives in the module the
assertion names), and **orphans** (no test cites a number that is not in the current revision).
Three conventions make it tractable: an id is qualified by its specification (`MIO-008 S7`) so
that it resolves to one assertion; ids are append-only once any test binds to them; and a
superseded assertion is struck through rather than deleted, so a reader of an old test can still
find what it was for.

Cost: three to four days, most of it in the parser and the waiver syntax, and the payoff is not in
the first week — it is in the fourth revision of a specification, when nobody remembers whether
the assertion that moved still has its test.

### Why it is not here

A one-day slice with one author and 147 assertions is exactly the regime where the map loses to
memory. The decision not to build it is in the open; the decision not to *know* that it is missing
would not have been.

---

## 3. Finding a specification's real forks before implementation (`Physarum`)

### The problem

The fourteen specifications here recorded 28 questions. Three went to the human and were answered
by him; 23 of the remainder are marked `(agent default)` — answered by me
([human-decisions.md](ai/human-decisions.md)). Every one of those defaults is a place where I could
not see a fork — and the cost of a default that was wrong is paid in review, or in production, not
in the specification phase. Hardening a specification by reading it harder has a ceiling: the
reader is the same mind that will implement it, and the forks it cannot see are precisely the ones
it will not ask about.

### The designed answer

Stop reading the specification and start probing it, with an architecture borrowed from a slime
mould (hence the nickname; *Physarum polycephalum* finds shortest paths through a maze with no
planner, by reinforcing the tubes that reach food and letting the rest evaporate).

From one specification and one base commit, start N short-lived agents, each in its own clone with
its own database, each given one small slice of the specification and a cheap check it must make
pass — a single endpoint, a single invariant. Nothing coordinates them. A sensor measures which
routes reached green, how, and at what cost; the routes that got there are reinforced into a
**network** — a machine-readable map returned alongside the specification — and the routes that
died evaporate, with their cause of death recorded. The forks the probes disagree about become
explicit questions for the human, in the one place where answering is cheap. The surviving network
then feeds the test-writing and implementation phases, so the plan is a measurement rather than a
guess.

What makes it worth building is the inversion: no planner chooses the route, so no planner's blind
spot survives into the implementation. What makes it hard to *trust* is that a run can produce
beautiful green numbers for trivial reasons — the probes measuring the project's rails (the
scaffolding generator, the lint rules) rather than the design question. So the design carries its
own controls: a null model (a route the planner predicted, to compare against), a calibration run
against a known reference, deterministic reduction of the network from the probes' evidence rather
than from an agent's narration, and per-agent isolation strict enough that one probe cannot poison
another (separate clones, separate databases, generated lock-step files regenerated rather than
merged).

Cost: roughly two weeks before the first run that could be *believed*, almost all of it harness —
clones, databases, the sensor, the deterministic reducer, the map validator — plus a dry run whose
only job is to show that the numbers move for the right reasons.

### Why it is not here, and its status

It is designed and reviewed; it has never been run. Presenting an unproven method inside a
submission as if it were a result would be the precise failure this repository is built to avoid.
It is here because the *problem* it addresses is real and visible in this slice's own artefacts —
23 of 28 questions answered by the author of the code — and because the shape of the answer is
part of what "working with AI as a code generator" will mean once a single agent writing a single
branch stops being the interesting case.

---

## The smaller ones, for completeness

| Gap | Answer | Where it is recorded |
| --- | --- | --- |
| No branch audit: a branch's prose can contradict its own diff, and two module documents here did contradict each other about an idempotency idiom | An audit pass over the branch's markdown against its final diff, before review | [how-ai-was-used.md](ai/how-ai-was-used.md#what-i-would-keep-and-what-i-would-drop) |
| The reviewer was a sibling session of the implementer — same model, same instructions, different context | A different model for review, and a human verdict on the review itself; the cheap half (a separate session with its own worktree, forbidden to sign off its own work) is what was done here | [evidence-log.md](ai/evidence-log.md#honest-limits-of-this-evidence) |
| Git distinguishes agent from human, but not *which* agent — one reviewer here attributed a merge to the wrong session | A per-session trailer on every commit, carried by the session's own harness | [evidence-log.md](ai/evidence-log.md#honest-limits-of-this-evidence) |
| `red-check` never ran on a pull request in CI, only locally — the job is `pull_request`-only and the repository has had no PR | A demonstration PR whose only purpose is to make the gate run where a reviewer can see it | [process.md](process.md) |
