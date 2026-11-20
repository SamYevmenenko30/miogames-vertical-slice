# Adversarial review, round 2 — `mio-games` at `7a2a80d`

A second adversarial pass, by a session that did not write the code, did not write the first
review, and did not write the fixes. Its brief was to treat
[`adversarial-review.md`](adversarial-review.md) as a **claim** rather than a map: re-derive each
finding by measurement, then attack the code the fix round added, which nobody has reviewed.

Everything below was executed in a private git worktree of this repository against a real
Postgres 17, a real Docker stack, and — where it mattered — real separate operating-system
processes. Nothing in the author's checkout was touched.

## Verdict

**I would not submit this as it stands.** Two of the four blockers are money defects that the
fix round introduced, and both are reachable through the deployment path the repository itself
documents. They are also cheap to fix — one is a `WHERE` clause.

The engineering underneath is good, and the parts round one could not reach came back mostly
clean: two real worker processes racing 80 redemptions through a slow operator produced exactly
one grant each, and no database connection is held across an operator call even at twelve-way
concurrency. The fix round's *tests* are real — I mutated the mechanisms they name and the right
test died every time. What is wrong is the **design** the lease chose, and the **pipeline's claim**
to have proved it.

| | Count |
| --- | --- |
| Blockers | 4 |
| Should-fix | 14 |
| Nits | 7 |
| Round-one findings re-measured | 25 (3 blockers, 13 should-fix, 6 nits, 3 open questions) |

Baseline re-measured independently: `pnpm verify` **PASS**, eleven gates; `pnpm test` **228 passed
in 32 files**; `pnpm gate-probes` **29/29**; `pnpm smoke` **PASS, 14 asserted steps**. Every claim
in the hand-over is accurate.

---

## Blockers

### R2-B1 — The lease recovers a wedged issuance by asking the operator to grant the reward a second time

`src/modules/rewards/application/issue-reward.usecase.ts:70-114`,
`src/modules/rewards/adapters/out/redemption.repository.ts:84-106`

B1's fix is correct about recovery and wrong about what recovery costs. A worker that dies
**after** the operator has granted the reward but **before** `markIssued` commits leaves the row
in `issuing` with a fresh lease. The sweep re-claims it when the lease expires and calls the
operator **again**. The only thing standing between that and a duplicate grant is
`Idempotency-Key: redemption:<id>` — a promise about somebody else's system.

Neither of this repository's own simulated operators honours it.
`src/mocks/casino-platform/app.ts:102` increments the grant counter and issues on **every** call;
there is no key store on either operator. So inside the system as shipped, a lease re-claim
grants twice.

**Measured, with real processes and a real `SIGKILL`** (full compose stack, two worker containers,
operator set to a 4 s delay so the kill lands mid-call):

```
operator has been asked; SIGKILL now
worker-k SIGKILLed                       → exit code 137
rewards.redemption:  issuing=1   claimed_by=issuance-25   fresh lease
GET /casino-a/_mock/reward-calls  →  {"calls":1}

… second worker process, ISSUANCE_CLAIM_TIMEOUT_MS=5000 …
RECOVERED
rewards.redemption:  issued  external_ref=A-d47fc6fd-…  attempts=0
GET /casino-a/_mock/reward-calls  →  {"calls":2}
```

The operator was asked to grant the same 50 free spins **twice**. The player paid 100 coins
**once**. And the row records `attempts=0` — because `attempts` only advances on a *failure*
write-back — so the recovered redemption is indistinguishable from a clean first-attempt success.
Nothing anywhere records that a first grant was ever requested: no audit row (the only production
caller of `AuditLog.record` is `wheel-config.service.ts`), no counter, no log line that survives
the dead process.

Also reproduced in-process, independently, before the Docker run: a crash between the operator's
200 and the write-back produced `operator grant calls = 3` (one 500, one lost grant, one regrant)
for a redemption charged once.

This is **the exact window the lease exists for.** Before the fix the failure was "coins gone, no
reward, wedged forever". After the fix it is "coins charged once, reward granted twice, and the row
looks clean". The second is harder to detect and costs the operator money every time.

Four places state the safety claim as a fact:

- `issue-reward.usecase.ts:38-42` — *"Re-attempting is safe because the intent below carries
  `redemption:<id>` as its idempotency key, so an operator that already granted the reward returns
  the same reference instead of granting a second."*
- `db/migrations/0012_redemption_issuance_lease.sql:9-13` — the same sentence.
- `docs/reliability.md`, case **"No duplicate rewards"** — *"The operator call carries
  `redemption:<id>` too, **which is what makes a lease re-claim safe**"*, with S10 and S7 cited as
  proof.
- `src/modules/integration/adapters/out/casino-a-reward.adapter.ts:25-26` is the one honest one:
  *"We cannot make them honour it; we can make it possible."*

`docs/assumptions.md:16-19` states the limit correctly — *"we cannot enforce that they honour it.
If they do not, a retried issuance may grant twice on their side"*. So the repository contains both
the honest statement and three contradictions of it, and `AGENTS.md` rule 9 is explicit that a
promise about another module's behaviour *"either moves there or becomes a line in
`docs/tech-debt.md`"*. It did neither.

What makes this a blocker rather than a documented limitation is that nothing is *recorded* at the
moment of ambiguity. A redemption whose outcome is unknown is written down as a redemption whose
outcome was a clean success. There is no state, no counter and no audit entry that would let anyone
reconcile with the operator afterwards — which is the mitigation `docs/assumptions.md` implies
exists when it says *"every attempt is recorded, and the status API shows exactly what we sent and
when"*. For the attempt that was lost, it is not recorded and the status API shows nothing.

### R2-B2 — A stale lease holder writes its failure back over a peer's success: the reward is issued **and** the coins are refunded

`src/modules/rewards/adapters/out/redemption.repository.ts:129-156`

`claimForIssuance` is a careful conditional `UPDATE`. The three write-backs that follow it —
`markIssued`, `scheduleRetry`, `markFailed` — are not conditional on anything. They check neither
the current `status` nor `claimed_by`:

```ts
.where(and(scopedWhere(redemption), eq(redemption.id, id)));
```

So a worker whose lease expired while its operator call was in flight comes back and overwrites
whatever happened in the meantime. The lease is taken once and never renewed, and the window
between claim and write-back is not bounded by anything the lease knows about:
`ISSUANCE_TIMEOUT_MS` (2 000 ms) and `ISSUANCE_CLAIM_TIMEOUT_MS` (60 000 ms) are independent
knobs with no stated relationship and no check that one is smaller than the other, and the window
also contains three identity reads and two pool acquisitions.

**Measured** (worker A stalls in the operator call past its lease; worker B takes over and
succeeds; A then returns a terminal failure):

```
P2: final status=failed  externalRef=A-81f277b0-35ad-4826-953a-71de62f980d0
    balance 400 -> 500   operator grants=1
```

The operator granted the reward. The coins came back. The player keeps both. And the row is
self-contradictory: `status='failed'` with a non-null `external_ref` holding the *successful*
reference, because `markFailed` clears `next_attempt_at`, `claimed_at` and `claimed_by` but not
`external_ref`.

The mirror case is as bad and needs no stall at all: A succeeds slowly, B's re-claim fails, and
B's `scheduleRetry` resurrects an **already issued** redemption into `pending_issuance`, so the
sweep issues it again.

The claim comment on `claimForIssuance` says the predicate exists so *"two workers cannot both
start issuing the same reward"*. That is true of *starting*. Nothing makes the same statement
about *finishing*, and the finish is where the money moves. A write-back that also required
`status = 'issuing' and claimed_by = <me>` would close this; a worker that finds its claim gone
has learned something worth logging rather than something worth overwriting.

### R2-B3 — `test-guard` and `red-check` are blind to three of the four ways a spec test can change, and the fix round's own tests went in through one of them

`scripts/test-guard.mjs:37-46`, `scripts/red-check.mjs:66-69`

`test-guard` exists for one failure mode, which it states itself: *"the implementation phase meets
a failing test, decides the test is wrong, and edits it until it passes. That is the single easiest
way to turn a spec-first pipeline into theatre."* It inspects `git diff --name-status` and looks at
exactly two statuses: `M` (shape 1) and `A`-then-touched-again (shape 2). `red-check` filters on
`--diff-filter=A`. Three other things a branch can do to a spec test are therefore invisible.

**1 — Delete it.** `git rm` a spec file and both gates pass:

```
$ git rm src/modules/gamification/__tests__/wheel-draw.spec.ts && git commit
$ git diff --name-status base..HEAD
D   src/modules/gamification/__tests__/wheel-draw.spec.ts
$ pnpm test-guard
   no test file was modified after it was written (base 7a2a80dd, 0 added)
test-guard: PASS
$ pnpm red-check
   nothing to check (no test file added on this branch).
red-check: PASS
```

Thirteen tests removed, and the gate prints a sentence that is literally false as reassurance.
`pnpm verify` is green afterwards, because the test is gone. Deleting a test is strictly easier
than bending it.

**2 — Rename it and edit it in the same commit.** Git reports that as `R`, which matches neither
filter:

```
$ git diff --name-status base..HEAD
R098  …/wheel-draw.spec.ts  →  …/wheel-draw-v2.spec.ts
$ pnpm test-guard  →  "no test file was modified after it was written"   PASS
$ pnpm red-check   →  "nothing to check (no test file added on this branch)"   PASS
```

`R098` means 98 % similarity — git is reporting *in the status itself* that the file was modified.

**3 — Add new test cases into an existing spec file.** `red-check` measures added **files**, so a
new `it(...)` in an existing file is never measured at the merge-base. This is not hypothetical:

```
$ git diff --name-status --diff-filter=A 3ef063e..main | grep spec.ts
NONE — red-check had nothing to measure
```

**Every** test the fix round wrote — `S11`, `S12`, `S13`, the strengthened `S10`, the new ledger
boundary cases, the rewritten RLS census — went into files that already existed. The three tests
that are the entire evidence for closing B1 and B2 never faced the gate whose purpose is to prove
that a test is real. `test-guard` noticed the files changed and accepted a `test-fix:` sentence;
that is all that happened.

I verified those tests by mutation myself and they are good (see **Clean categories**). The defect
is that *the pipeline did not establish that* — I did, afterwards, with a tool the pipeline does
not have. For a submission whose headline claim is "the gates themselves were tested", that gap
matters more than any single test.

No probe covers any of the three. `gate-probes` has two `test-guard` probes, both `M`-shaped.

### R2-B4 — `red-check` passes a ticket with a broken implementation and three worthless tests

`scripts/red-check.mjs:226-246`

The new rule says a ticket whose added files are **all** crash-red is not proved, and must either
produce one assertion-red file or declare each crash-red one. It is an **aggregate** rule:
`if (results.length && !counts['assertion-red'] && crashRedFiles.length)`. One assertion-red file
switches the whole check off, for every crash-red sibling, undeclared.

And "assertion-red" is awarded on the error *class* vitest printed — not on the assertion having
observed anything the branch does. A test that asserts a **file exists on disk** resolves at the
merge-base, fails there on an `AssertionError`, passes on the branch, and earns the gate's
strongest verdict.

**Measured.** One commit: a deliberately broken implementation (`tierFor` returns `0` for every
deposit), plus a file-existence assertion, a fully `it.skip`-ped test, and a
`expect(typeof tierFor).toBe('function')` tautology.

```
$ pnpm red-check
✓  assertion-red  src/platform/probe/e1-present.spec.ts
✓  crash-red      src/platform/probe/e2-skipped.spec.ts      Cannot find module
✓  crash-red      src/platform/probe/e3-tautology.spec.ts    Cannot find module

3 file(s): 1 assertion-red, 2 crash-red
red-check: PASS — every added test file fails without this branch.

$ pnpm test-guard  →  PASS
$ vitest run src/platform/probe  →  Tests  2 passed | 1 skipped (3)
```

Three variants of the attack, each measured separately:

| Attack | Verdict | Blocked? |
| --- | --- | --- |
| Tautology importing new code, **alone** | crash-red, undeclared | **yes** — the new rule fires |
| Spec with every test `it.skip`-ped, **alone** | crash-red, undeclared | **yes** |
| `expect(existsSync('…new file…')).toBe(true)` | **assertion-red** | no |
| Either of the first two **beside** a file-existence assertion | 1 assertion-red, n crash-red | no |

So the single-file case round one found is closed, and the composite case is not. Two further
observations about the classifier, from reading it after driving it: nothing in the repository
checks for `it.skip` / `describe.skip` / `.only` (`grep` over `scripts/*.mjs` finds no match), so a
skipped spec test satisfies `pnpm verify`; and because `/assert/i` is in the `assertion` pattern
and `AssertionError` is excluded from the crash-class scan, a test that throws its own
`AssertionError` without evaluating an expectation is classified assertion-red too.

The honest-limits block at the top of the file is unusually good, and this finding is the one thing
it does not say: it warns that *crash-red* proves little, and does not warn that *assertion-red*
proves only that an `AssertionError` happened somewhere.

---

## Should-fix

### S1 — The worker never exits on `SIGTERM`; every stop is a `SIGKILL`, which is the event that triggers R2-B1

`src/platform/platform.module.ts:20-37`, `src/main.worker.ts:59-66`

`DATABASE` and `OWNER_DATABASE` are factory providers returning an object with a `close()` method.
Nothing ever calls it: no provider implements `OnModuleDestroy` or `OnApplicationShutdown`, and
Nest does not call lifecycle methods on a plain object. So `app.close()` returns, the postgres
pools keep their sockets, and the event loop never drains.

Measured on the shipped compose stack:

```
$ time docker stop mior2-worker-r        →  10.28 s
$ docker inspect --format '{{.State.ExitCode}}'  →  137      (SIGKILL)
```

Ten seconds is Docker's grace period exactly. Every rolling deploy, every scale-down and every
`docker compose restart worker` hard-kills a worker that may be mid-issuance — which is precisely
the crash that produces the duplicate grant in R2-B1. The two findings compound: the system's
*normal* operational path triggers its worst failure mode. (`pnpm dev:worker` runs through
`pnpm` → `node --watch`, so the handler in `main.worker.ts` may not even receive the signal; the
missing pool close makes it moot either way.)

### S2 — `pnpm db:seed` finishes its work and never exits

Same root cause. Step 5 of the documented first run in
[`docs/local-development.md`](../local-development.md) hangs. I let it run for 300 s; the data was
committed within the first second (2 tenants, 2 wheels, 2 rules, 2 store items; `pg_stat_activity`
showed its backends `idle` after `commit`) and the process never returned. `scripts/db-seed.ts:34`
awaits `app.close()` in a `finally`, which is as much as it can do. `pnpm db:migrate` exits
correctly because `applyMigrations` ends its own client in a `finally`
(`src/platform/db/migrator.ts:44-46`).

A reviewer following the README gets a terminal that never comes back on the fifth command.

### S3 — The application does not verify the schema version and does not refuse to start, which is what the docs say it does

[`docs/local-development.md`](../local-development.md) §"Why migrations never run at boot":
*"The deploy applies migrations as its own step; the application only verifies that the schema
version it needs is present and refuses to start otherwise."*

`src/main.api.ts:11-23` creates the app and listens. There is no required-version constant, no
comparison, and no refusal. `HealthController` reports the newest applied version and answers 503
if the table is unreachable — and its own comment says so correctly: *"this endpoint reports what
was applied, so a wrong answer is visible rather than silently corrected."* Two pieces of prose in
the repository contradict each other and the code matches the second.

Observed directly: with the stack up and migrations not yet applied, the api was listening and
serving `{"ok":false,"schemaVersion":null,"role":"api"}`.

### S4 — `pnpm verify` dirties the working tree, and makes the committed samples unverifiable by construction

`scripts/verify.mjs:21`, `scripts/smoke.ts:310-322`

`smoke` is the last step of `verify` and rewrites `docs/samples/part-b-flow.http.md` from the run.
The file is full of generated UUIDs, so the rewrite is never a no-op:

```
$ git status --porcelain      (clean)
$ pnpm smoke                  smoke: PASS — 14 asserted steps
$ git status --porcelain       M docs/samples/part-b-flow.http.md
$ git diff --stat             1 file changed, 46 insertions(+), 46 deletions(-)
```

I agree this is a defect, and the worse thing it hides is not a masked gate — I looked for one and
did not find it; `gate-probes`' working-tree overlay and `red-check`'s `git show HEAD:<path>` are
both unaffected. It is this: because the file can never be reproduced, **nothing can ever check
that the committed samples correspond to the current code.** CI runs `pnpm smoke` and never
compares. A sample that drifted from the implementation would be invisible, while the file's own
header promises *"Captured by `pnpm smoke` from a real run"*. Commit `7a2a80d chore: the samples
from the post-fix smoke run` is the churn being absorbed by hand.

Writing only under an explicit flag, or normalising the volatile fields, would fix both halves.

### S5 — No `.dockerignore`: a 172 MB build context, and the host's `node_modules` copied over the image's

The `dev` and `build` stages are `COPY . .` and nothing is excluded. Measured: the build context
transferred **172.74 MB**, which is `node_modules` (267 MB on disk) plus `.git` (9.7 MB) plus
`dist`. The host's `node_modules` lands on top of the one `pnpm install --frozen-lockfile` just
built in the `deps` stage, including platform-specific native binaries (`@swc/core`, `esbuild`).

It happens to work here because `COPY` merges rather than replaces, so the Linux bindings installed
in `deps` survive beside the macOS ones and pnpm resolves the right optional dependency at runtime.
That is luck, not design, and it would not survive a cross-platform build.

### S6 — Before migrations, the worker logs an authentication failure at error level every 250 ms, forever

In the documented first-run order (`docker compose up -d`, *then* `pnpm db:migrate`), the role
`mio_app` does not exist yet — migration `0010` creates it. The worker starts anyway and spins:

```
{"level":50,…,"err":"PostgresError: password authentication failed for user \"mio_app\"","msg":"outbox relay tick failed"}
{"level":50,…,"msg":"issuance retry sweep failed"}      ← with the full SQL and parameters
```

Four error lines per second, each carrying a full query dump, until someone runs the migration.
A reader's reasonable conclusion is that the stack is misconfigured. The relay has no backoff for
a failing *tick* (only for a failing *row*, in `recordFailure`), so there is nothing to damp it.

### S7 — `arch-check`'s event census is keyed to a hardcoded list of six module names — the same defect class round one found in the RLS census, fixed there and left here

`scripts/arch-check.mjs:193`

The name pattern it scans `src/contracts` with alternates six literal module names:

```
(?:identity|integration|ingestion|gamification|ledger|rewards|casino)\.[a-z_]+\.[a-z_]+
```

An event schema belonging to a module not in that list is never seen, so the rule *"every event
name used in code must be declared by some module"* cannot fire for a new module — exactly when a
reviewer most needs it. Measured as a clean A/B against the same file:

```
# control — a known namespace
+ export const REWARDS_SNEAKY = 'rewards.sneaky.happened';
✗  event rewards.sneaky.happened has a schema but no module declares it in emits/consumes
arch-check: FAIL — 1 problem(s)

# the blind spot — a new module's namespace
+ export const PVP_MATCH_STARTED = 'pvp.match.started';
arch-check: PASS (1 warning(s))
```

Round one's S2 was the identical shape (five hardcoded schemas in the RLS census), and the fix
round replaced it with a catalogue-wide query — correctly; I confirmed it (see the table below).
The hardcoded list here is three lines above the code that was being edited at the time.

### S8 — `markDueForIssuance`'s guard states an invariant that no test holds

`src/modules/rewards/adapters/out/redemption.repository.ts:120-124`

```ts
// Only when it has no schedule yet: a redelivered event must not pull a
// backoff the sweep has already set forward.
isNull(redemption.nextAttemptAt),
```

Removing that predicate leaves **228/228 green** (mutant M5). The guard is correct — a redelivered
`rewards.redemption.requested` would otherwise reset `next_attempt_at` to now and discard an
accumulated backoff — but it is the only mechanism in the lease work with no test behind it, and it
is the kind of clause a later refactor deletes as redundant.

### S9 — `claimed_by` identifies nothing in a container, which is where it runs

`src/modules/rewards/rewards.module.ts:83` — `instanceId: \`issuance-${process.pid}\`` — with
`issue-reward.usecase.ts:17` explaining it as *"Stamped on the claim, so a stuck redemption names
the worker that took it."*

In the compose stack the api was pid 25 and the worker pid 26; the worker I killed reported
`claimed_by=issuance-25`. Containers have their own PID namespace, so replicas collide routinely
and the column cannot distinguish them. `OutboxRelay`'s `relay-${process.pid}` has the same issue.
A hostname, a container id or a per-process UUID would make the field mean what the comment says.

### S10 — The worker publishes a fixed host port, so it cannot be scaled

`docker-compose.yml` — the `worker` service maps `ports: ['3002:3002']`.

```
$ docker compose up -d --scale worker=2
Error response from daemon: … Bind for 0.0.0.0:3002 failed: port is already allocated
```

The worker is the one service the architecture says to run several of (`main.worker.ts:18-20`,
`docs/scaling.md`), and the lease and the outbox `SKIP LOCKED` claim exist precisely for that case.
I had to start the second and third workers with bare `docker run` to test them. Dropping the host
mapping (or using `3002` on the container side only) makes `--scale` work.

### S11 — No statement, transaction, lock or pool-acquire timeout anywhere

`src/platform/db/database.ts:22-28` passes only `max`, `onnotice` and `transform`. A `grep` across
`src`, `db` and `scripts` for `statement_timeout`, `idle_in_transaction_session_timeout`,
`lock_timeout`, `connect_timeout` and `idle_timeout` returns nothing.

`postgres.js`'s acquire queue is unbounded and untimed, so a saturated pool makes callers wait
rather than fail. I reached the ceiling with very little: twelve concurrent issuances against a
600 ms operator put the pool at its maximum of 10 with two callers queued. Nothing went wrong —
see the clean result below — but for a money system, "no statement will ever be cut off" is a
decision worth making on purpose rather than by omission.

### S12 — "`execute` has exactly one caller" is prose, and the module exports the means to break it

`issue-reward.usecase.ts:30-32` carries the invariant that keeps the HTTP call out of a
transaction. In the current tree it holds — I checked every reference, and the only production
caller is `IssuanceWorker:40`. But `IssueRewardUseCase` is exported from
`src/modules/rewards/index.ts:5` and listed in the module's `exports`, so any future consumer can
call `execute` from inside its own transaction and silently restore the defect S3 was raised for.
The use case already injects the unit of work and `UnitOfWork.inTransaction()` already exists, so
the invariant can be enforced where it is stated instead of described.

### S13 — `docs/reliability.md` cites S11 as proof of the case S11 does not exercise

The row for **"Retries and eventual recovery"** reads: *"S11 — a worker killed between the operator
call and recording is recovered once its lease expires."*

S11 (`issuance.integration.spec.ts:295-334`) replaces `IntegrationFacade.issueReward` with a stub
that **throws instead of calling**, and its own comment says so: *"The worker dies after claiming,
at the operator call."* No grant is ever requested. The case the table describes — killed *between*
the call and the recording — is the dangerous half, is the one that duplicates a grant (R2-B1), and
has no test. Two states that need different answers are being proved by the same test name.

### S14 — `docs-links` is in `verify` but not in CI *(closed: it is in the `gates` job now)*

`.github/workflows/ci.yml` runs lint, typecheck, arch-check, board:check, spec-gate, test-guard and
build in the `gates` job. `pnpm docs-links` is one of `verify`'s eleven gates and is absent, so the
documentation-link check is local-only on a repository that cross-references heavily — and whose
evidence log names a rotted link as one of the defects that gate was written to catch.

---

## Nits

- **N1** `db/migrations/` jumps `0010` → `0012`; no `0011` ever existed in the history
  (`git log --diff-filter=A` over the directory). Harmless, but it reads like a lost migration and
  a reviewer will ask. Relatedly, `applyMigrations` applies "every file not yet recorded, in sorted
  order" with no watermark check, so a file added later with a lower number would be applied after
  its successors rather than refused.
- **N2** `AGENTS.md:47` describes `test-guard` as *"No pre-existing spec test was modified without a
  `spec-conflict:` commit"*. The gate also accepts `test-fix:` (which is the declaration the fix
  round actually used, nine times) and also covers shape 2, added-then-bent.
- **N3** The `runtime` Dockerfile target is used by nothing: no compose service selects it, no
  script runs it. It does build — I built it, `exit=0` — but the image a deploy would ship is never
  exercised by the repository's own tooling, and the worker's runtime command exists only as a
  sentence in a comment.
- **N4** `markFailed` (`redemption.repository.ts:151-156`) clears `next_attempt_at`, `claimed_at`
  and `claimed_by` but not `external_ref`. That is how R2-B2's row ends up `failed` while holding a
  successful operator reference.
- **N5** Round one's **N6** still stands unchanged: `gate-probes` cleans up its worktree at
  `:580-581` rather than in a `finally`, so an interrupted run leaves `.tmp/probe-wt-<pid>`
  registered. I hit no leak in a full run, and the code fact is unaltered.
- **N6** `dueForRetry` orders by `next_attempt_at nulls first, claimed_at nulls first` under a
  `limit`. Today only a hand-made `issuing` row has a null `next_attempt_at`, so nothing starves;
  if a future path leaves that column null on a claimed row, those rows would sort ahead of every
  due retry in every batch.
- **N7** `scripts/docs-links.mjs` does not skip fenced code blocks, so a document that *quotes*
  code containing square brackets immediately followed by a parenthesised group is read as
  containing a markdown link, and the gate fails on a target that was never a link. I hit it twice
  writing this review — once on a quoted regular expression, once on the sentence describing the
  first — and the gate reported *"links to (?:identity|integration|…, which does not exist"* and
  then *"links to y, which does not exist"*. A false positive in a link checker is cheap to work
  around and expensive to trust.

---

## Round one, re-measured

Each verdict is mine, from my own measurement, not from reading the fix diff.

### Blockers

| # | Round-one claim | Verdict | My measurement |
| --- | --- | --- | --- |
| **B1** | A redemption in `issuing` is never recovered; coins gone permanently | **partly closed** | The defect was real and recovery now works: `M2a` (lease branch removed from `claimForIssuance`) and `M2b` (removed from `dueForRetry`) each kill S11 **and** S12; `M2c` (dropping *"`claimed_at` null counts as stale"*) kills S12 alone, which is exactly the case migration 0012 claims to inherit. Confirmed with a real `SIGKILL` across processes. **But** the recovery it bought grants the reward a second time (**R2-B1**) and its write-back can refund an issued reward (**R2-B2**). The old failure is fixed; a new one with money on the other side replaced it. |
| **B2** | S10 proves nothing, and is the only test for "two workers cannot both issue" | **closed** | The new S10 is real. `M1` (status predicate deleted from `claimForIssuance`) kills S10 and **only** S10 — 1 failed / 227 passed. It counts calls at the operator, as it claims. The mechanism is also correct across processes: two worker containers, 80 redemptions, a 250 ms-slow operator → exactly 40 + 40 grants, 80 `issued`, 0 refunds. |
| **B3** | `red-check` passes a test that asserts nothing | **partly closed** | The single-file case is closed (measured: a lone tautology and a lone all-skipped spec are both refused as undeclared crash-red). The composite case is open: one file-existence assertion licenses unlimited undeclared vacuous siblings — **R2-B4**, demonstrated with a broken implementation and three worthless tests passing every gate. |

### Should-fix

| # | Verdict | My measurement |
| --- | --- | --- |
| **S1** — classifier reports its strongest verdict for a run that never asserted | **partly closed** | The error-class discriminator works for the case it was written for: the repo's own probe `red-check/a-typeerror-is-crash-red-not-assertion-red` passes, and my `Cannot find module` cases all came out crash-red. It remains fooled by a self-thrown `AssertionError` and by an assertion that observes no behaviour (**R2-B4**). |
| **S2** — RLS census blind to a new schema | **closed** | The census is now catalogue-wide (`pg_class` × `pg_namespace`, `src/platform/db/__tests__/row-level-security.integration.spec.ts:109-120`). Measured: adding migration `0099` creating schema `pvp` with a `tenant_id` table and no policy fails S7. The same defect class survives in `arch-check`'s event census — **S7** above. |
| **S3** — the operator call runs inside an open transaction on the first attempt | **closed, and verified more strongly than claimed** | `M4` (consumer calls `execute` inline again) kills S13 and only S13. The structural claim holds at the database level too: at twelve-way concurrency against a 600 ms operator, the oldest open transaction observed in `pg_stat_activity` was **41 ms** (details below). |
| **S4** — `FOR UPDATE` on the balance is unproven | **closed** | `M7` (removing `for update` from the balance read) kills `ledger S6`, which is the test now named for it. |
| **S5** — off-by-one overdraft: a player cannot spend their exact balance | **closed** | `M8` (`<` → `<=`) kills `ledger S3 — a debit of exactly the balance succeeds and leaves zero`. |
| **S6** — the attempt budget's boundary is unproven | **closed** | `M9` (`>=` → `>` on `maxAttempts`) kills `issuance S6`. `M10` (refund removed entirely) kills S6, S7 and S8. |
| **S7** — idempotency re-read unscoped-tolerant, suite runs with RLS off | **closed** | `redemption.integration.spec.ts:33` uses `startTestApi`, which `api.helper.ts:29` points at `db.appUrl`; `arch-check:180` now fails if that ever changes, and `gate-probes` probes that rule. The re-read itself uses `scopedWhere`. |
| **S8** — database isolation rests on one file | **partly closed, by design** | `arch-check:125-139` now requires every `*isolation*.integration.spec.ts` to connect as the application role or carry a written waiver, and `gate-probes` probes both halves. One waiver remains (`identity-isolation`, *"the last case here authenticates key-a"*) and `arch-check` prints it as a warning on every run. That is a declared, visible state rather than a silent one. |
| **S9** — the facade re-export rule is bypassed by the wiring file | **closed** | `arch-check:149-162` checks both `index.ts` and `<name>.module.ts`, with a probe. |
| **S10** — `TD-0010` cited as justification and does not exist | **closed** | `docs/tech-debt.md` now carries TD-0010, and it describes the right thing (the withheld privilege is only half the control; the trigger is the other half). |
| **S11** — three checkable claims in the evidence log are wrong | **closed** | `docs/ai/evidence-log.md:10` now says *"six of them … were dead or wrong on the first run"* and names them, which matches the table beneath it. This also closes round-one **N5**. |
| **S12** — `AGENTS.md` understates `pnpm verify` by four gates | **closed** | `AGENTS.md:44` lists all eleven in `verify.mjs`'s order. I diffed the two lists. |
| **S13** — the escape hatch accepts any sentence | **closed, and used well** | The gate now requires ≥ 15 characters and splits `spec-conflict:` from `test-fix:`. Every spec file the fix round modified carries a declaration, and the split is used correctly: nine `test-fix:` lines for strengthening, one `spec-conflict:` for the genuine disagreement (S10 stating a mechanism rather than an observable). This is the finding whose fix I trust most. |

### Nits

**N1** (SKIP LOCKED redundant in the entitlement claim), **N2** (`spin.usecase` re-derives the
balance), **N3** (`0010`'s "nothing that removes history" comment), **N4** (`infra.audit_log`
outside S7's census) — all four were accurate, and N4 is now moot because the census covers every
schema. **N5** closed with S11. **N6** still stands — see my N5.

### Open questions Q1–Q3

- **Q1 — are the surviving redundant predicates defence in depth?** A genuine design question, and
  round one was right to file it as one rather than pad the list. My reading agrees with its
  answer: the tenant clause in `claimForIssuance` is not redundant the day ids stop being globally
  unique, and it makes the statement readable. No test is needed to distinguish it.
- **Q2 — is `issuing` meant to be recoverable at all?** **This was a defect it failed to make
  concrete, and the fix answered it the wrong way round.** The question it should have asked is the
  one with money on both sides: *when a worker dies after the operator call, which do you prefer —
  a redemption wedged until a human resolves it, or a silent second grant?* The fix chose the
  second without the question being put, and that choice is R2-B1. It is still written down
  nowhere: no ADR, no line in `docs/tech-debt.md`, and `docs/reliability.md` presents it as a
  solved case.
- **Q3 — is the owner/app split across suites deliberate?** A genuine design question, now
  effectively resolved: the fix round moved most suites to the application role and declared the
  remainder, and `arch-check` enforces it. It needs no further answer.

Round one's own **M28** — *"the relay marks an event published before dispatching it"* — which it
disclosed as an invalid patch and therefore unmeasured: **the mutant is caught.** Moving
`markPublished(row.id)` above the handler loop in `relay.ts:70-74` fails exactly one test,
`outbox S12 — a handler that throws leaves the event unpublished, with an attempt recorded`. The
unmeasured question resolves in the code's favour.

---

## Clean categories

Reported plainly, because "the fixes hold" has to be trustworthy where it is true.

**The fix round's tests are real.** Ten mutations of the mechanisms they name, each run against the
full suite, each killing the right test and nothing else:

| Mutant | Killed |
| --- | --- |
| M1 — status predicate dropped from `claimForIssuance` | S10 only (1 / 228) |
| M2a — lease branch dropped from `claimForIssuance` | S11, S12 |
| M2b — lease branch dropped from `dueForRetry` | S11, S12 |
| M2c — "`claimed_at` null is stale" dropped from both | S12 only |
| M3 — early return dropped from `idempotent-consumer` | gamification S5, outbox S11, outbox S12 |
| M4 — consumer issues inline again | S13 only |
| M6 — tenant scope entered inside the transaction | 17 tests across four suites |
| M7 — `FOR UPDATE` removed from the balance read | ledger S6 only |
| M8 — overdraft guard off by one | ledger S3 only |
| M9 / M10 — attempt budget off by one / refund removed | issuance S6 / S6+S7+S8 |

Only **M5** survived (**S8** above). For a suite of 228 tests that is a strong result.

**Multi-process concurrency — clean.** Two independent worker containers, one database, 80
redemptions across two tenants, operator delayed 250 ms so the claim windows genuinely overlap:
`issued=80`, `casino-a calls=40`, `casino-b calls=40`, zero ledger refunds. The conditional
`UPDATE` settles the race across processes, not just across promises in one event loop. The same
run exercised two outbox relays against each other with no duplicated effect.

**No connection is held across an operator call — clean, and verified at the database.** Twelve
concurrent issuances (more than the pool maximum of 10) against an operator delayed 600 ms, while
sampling `pg_stat_activity` every 25 ms:

```
P3: samples=18  worst "idle in transaction"=6  OLDEST OPEN TX=41ms (operator delay 600ms)
    worst total connections=10  operator calls=12
```

Six connections are momentarily `idle in transaction` — that is just the gap between a connection's
own statements, and my first assertion wrongly treated it as the defect. The discriminating
measurement is the **age** of the open transaction: 41 ms against a 600 ms call. Nothing is held.
This is stronger than S13, which only observes the application-side flag.

**`pnpm gate-probes` — 29/29, run end to end in my own worktree.** Every probe behaved: each gate
went red on its planted violation and green without one, and the three classifier probes accepted
what they should. The design — a baseline run before every violation run — is the right one, and
the working-tree overlay means a gate is probed before it is committed rather than after.

**Docker — works.** `--target runtime` builds clean. The full `dev` stack (postgres, api, worker,
casino-mock) comes up; `pnpm db:migrate` applies all eleven migrations including `0012`; the api
serves; one worker drained 80 redemptions correctly. The problems I found are the ones listed above
(S1, S5, S6, S10), not the stack failing to run.

**`pnpm smoke` — PASS**, 14 asserted steps across both operators, including the independent
recomputation of the spin outcome from the revealed seed. It genuinely asserts; it is not a demo
that prints things. Its only defect is where it writes (S4).

**Round-one S2's fix generalises correctly.** A new schema with an ungoverned tenant table now
fails S7 — measured, not read.

---

## Claims I could not check, and why

- **Whether a real operator honours `Idempotency-Key`.** Out of reach by definition. What I can
  state is narrower and is what I reported: neither simulated operator in this repository honours
  it, so the claim is false *inside the system as shipped*.
- **Round one's mutants M11–M27 individually.** I re-measured the ones bearing on the fixes and on
  the Part C table, not the whole campaign. Where I did not re-measure, I have marked the round-one
  finding as accurate rather than verified.
- **`pnpm review:request <ticket>` end to end.** It needs a card in the right column; I ran its
  components (`verify`, `spec-gate`, `red-check`, `test-guard`, `gate-probes`) individually.
- **CI as executed.** There is no remote and no run history. I read `.github/workflows/ci.yml` and
  report one omission from it (S14); I did not observe it running.
- **R2-B2's reachability under the shipped default configuration.** I demonstrated the mechanism by
  ageing the lease, which is the same technique S11 uses. The claim→write-back window exceeding a
  60 s lease needs an adverse condition — a paused process, a saturated pool, or
  `ISSUANCE_CLAIM_TIMEOUT_MS` set below `ISSUANCE_TIMEOUT_MS`, which nothing forbids. I did not
  produce that condition naturally; the missing predicate is a fact about the code either way, and
  R2-B1 needs no adverse condition at all.
- **Whether `AuditLog` is meant to cover money movements.** Its only production caller is the admin
  wheel surface. I read that as deliberate (the ledger is append-only and is the money audit) rather
  than as a gap, and I did not raise it — but it is why R2-B1 leaves no trace.

---

## What I would insist on before this is submitted

1. **Make the write-backs conditional on still holding the claim** (R2-B2). `markIssued`,
   `scheduleRetry` and `markFailed` should require `status = 'issuing' and claimed_by = <me>`, and
   a worker that finds its claim gone should log rather than overwrite. This is the cheapest fix on
   the list and it closes a path that refunds an issued reward.
2. **Decide R2-B1 out loud, and record the ambiguity.** Either the duplicate grant is accepted —
   in which case `issue-reward.usecase.ts`, `0012`'s comment and `docs/reliability.md` must stop
   saying a re-claim is *safe*, and it becomes a line in `docs/tech-debt.md` — or the system records
   that a grant was requested before it makes the call, so a recovered redemption can be reconciled
   instead of looking like a clean success. Either answer is defensible; the current state asserts
   the safe one and implements the other.
3. **Close the `git rm` / `git mv` holes in `test-guard`** (R2-B3). Handling `D` and `R` statuses is
   a few lines, and until then the gate's own stated purpose is bypassable by a rename. A probe for
   each, since no probe covers either.
4. **Say what `red-check` cannot prove about `assertion-red`** (R2-B4), and consider making the
   crash-red declaration per-file rather than per-ticket. The honest-limits block at the top of that
   file is the best thing in the repository's tooling; this is the one sentence missing from it.
5. **Call `close()` on the two database pools** (S1, S2). One `OnApplicationShutdown` provider fixes
   a hanging `db:seed`, a ten-second `SIGKILL` on every worker stop, and — because that `SIGKILL` is
   the trigger — reduces how often R2-B1 fires.
6. **Fix the two prose claims that are simply false**: the api does not refuse to start on a wrong
   schema version (S3), and S11 does not test what `reliability.md` says it tests (S13).

Items 1, 3 and 5 are each under an hour. Item 2 is a paragraph and a decision. Taken together they
turn the two blockers into a documented design choice and the pipeline's claim into a true one —
which, for an assignment graded on engineering judgment, is a better story than the fixes being
perfect the first time.

---

## Method

Each finding above was executed, not inferred. The worktree was reset between measurements, and
every mutation was run against the **full** suite rather than the file it was expected to break, so
that a mutation killing the wrong test would show up. Two probe specs (the lease write-back window
and the connection census) were written, run and removed; they are not part of this change. Two
mutation findings were wrong on the first attempt and corrected by re-measuring: my connection
assertion conflated "in a transaction" with "in a transaction across the operator call", and the
rename attack was first measured with a stray `node_modules` symlink in the diff, so both were
re-run clean. This review changes no file but itself.
