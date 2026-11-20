# Adversarial review — `mio-games` at `3ef063e`

An independent, hostile read of the whole repository, run in a separate git worktree so that
every mutation and probe below was executed against a throwaway copy. Nothing in the author's
checkout was touched.

**Method, so each claim below can be re-run.**

| What | How |
| --- | --- |
| Baseline | `npx vitest run` → **32 files, 221 tests, green, 15.6s** |
| Mutation campaign | 30 hand-written mutants, each planted, the **whole** suite run, then reverted (`.tmp/mutate.mjs`). Result: **20 killed, 10 survived** |
| Concurrency semantics | A direct two-transaction probe against a migrated throwaway database (`.tmp/concurrency.mjs`) |
| `red-check` | Run end-to-end on two synthetic branches in a second worktree |
| RLS census | A new tenant-owned table planted in a new schema, then the suite + `arch-check` re-run |
| Stuck-money blocker | A probe test built on the repo's own `issuance.integration.spec.ts` harness |

**Severity counts: 3 blockers · 13 should-fix · 6 nits · 3 open questions.**

A deliberate note up front, because it is the most useful thing I can say about this codebase: in
the category where I expected the most damage — *"invariants that are only prose"* — I found
almost nothing. The database invariants are real and they are load-bearing. Details under
[Claims I verified](#claims-i-verified-and-how), including the negative results.

---

## Blockers

### B1 — A redemption that reaches `issuing` is never recovered: the coins are gone, permanently

`src/modules/rewards/adapters/out/redemption.repository.ts:69-76` and `:125-135`

`claimForIssuance` moves `pending_issuance → issuing`. `dueForRetry` — the only thing that ever
looks for work again — selects `where status = 'pending_issuance'`. There is no sweep, reaper,
lease or timeout for `issuing`. I grepped the whole tree: `issuing` appears in 10 places and not
one of them reads a stale row back out.

In the **retry** path the claim commits in its own transaction
(`issuance.worker.ts:36` calls `issue.execute` with no transaction open, so
`issue-reward.usecase.ts:40` opens and commits one). If the worker then dies at the operator call
— the exact case the assignment names — the row stays `issuing` forever. The outbox event for that
redemption was published on the first attempt, so nothing redelivers it either.

**Concrete, and executed.** A probe on the repo's own harness: redeem (price 100 of 500 coins,
balance → 400) → one retryable failure so the retry sweep owns the next attempt → the worker throws
at the operator call → then **ten healthy worker cycles**:

```
status      = 'issuing'      (unchanged after 10 drains)
external_ref = null          (no reward was ever issued)
balance      = 400           (the 100 coins are never refunded)
```

The player paid 100 coins, received nothing, and will never be refunded or retried. Both probe
assertions pass, i.e. the bug reproduces deterministically.

Two things make this worse rather than better:

- `src/modules/rewards/AGENTS.md:17-19` states the opposite as an enforced invariant:
  *"Leaving `issuing` without an external reference refunds the coins, keyed
  `redemption:<id>:refund` …"*. No code does this. The refund at
  `issue-reward.usecase.ts:103-124` runs only when a **live** worker gets a terminal or
  budget-exhausted result; a worker that died never reaches it. A reader checking this invariant
  finds a sentence and stops.
- `docs/scaling.md:25` lists the alert as *"redemptions stuck in `pending_issuance`"* — the state
  that is **not** stuck. The one state that can wedge is unmonitored by the stated plan.

**Fix direction** (offered as a direction, not a patch — see the review skill's own warning): give
the claim a lease (`claimed_at`/`claimed_by` on the redemption, as `infra.outbox` already has) and
have `dueForRetry` also return `issuing` rows whose lease is stale. The operator call is already
keyed `redemption:<id>` (`issue-reward.usecase.ts:60`), so a re-attempt is safe. Then fix the two
prose claims above.

### B2 — MIO-010 S10 proves nothing, and it is the only test for "two workers cannot both issue"

`src/modules/rewards/__tests__/issuance.integration.spec.ts:244-263`

The spec statement (`docs/specs/MIO-010.md:50-51`) is:

> **S10 — issuance is claimed exactly once.** Two workers draining the same redemption produce
> one operator call: the `pending_issuance → issuing` transition is a conditional UPDATE.

The test calls **one** consumer twice with **the same event id**, then asserts
`status === 'issued'` and `attempts <= 1`. Three separate problems:

1. **It measures the wrong mechanism.** Two `consume()` calls with one event id are stopped by
   `infra.processed_event` in `idempotent-consumer.ts:51-57`, not by the conditional UPDATE the
   statement names. Event-level idempotency is already proved elsewhere (`outbox.integration.spec.ts`
   S11/S12).
2. **It never counts operator calls**, which is the thing the statement promises. `attempts <= 1`
   is an inequality satisfied by `0`; it is not a count of calls to the operator.
3. **It cannot fail unless two independent guards break at once.** Measured both ways:
   - mutant **M17** deleted `eq(redemption.status, 'pending_issuance')` from `claimForIssuance`
     — *the mechanism S10 names* — and the full suite, S10 included, stayed **green (221/221)**;
   - mutant **M26** deleted `if (claimed.length === 0) return;` from the idempotent consumer — the
     guard that actually carries S10 — and S10 **still passed** (only `outbox` S11/S12 and
     gamification S5 died).

   A test that goes green when either of the two things that could make it green is removed is
   proving neither. The two-worker race it claims to cover — the retry sweep racing the outbox
   consumer, or two relay processes — is never exercised anywhere in the suite.

This is a test that proves nothing, on a money path, guarding a claim repeated in three documents
(`docs/reliability.md:10`, `MIO-010.md:51`, `rewards/AGENTS.md:15-16`).

### B3 — `red-check` passes a test that asserts nothing, and that is the dominant mode in this repository

`scripts/red-check.mjs:123-151`, and `AGENTS.md:12-15`

`AGENTS.md` rule 2 states the central claim without qualification: *"A test you cannot see fail is
not a test. `pnpm red-check` must prove every test file the branch adds fails at the merge-base. If
a test passes without the implementation, delete it or fix it."*

I ran the gate end-to-end on a synthetic branch whose only test is a tautology:

```ts
import { computeImportantThing } from '../domain/thing';   // branch-added file
it('S1 — the module can be imported', () => {
  expect(typeof computeImportantThing).toBe('function');
  expect(1).toBe(1);
});
```

```
✓  crash-red      src/modules/probe/__tests__/vacuous.spec.ts
      Cannot find module
red-check: PASS — every added test file fails without this branch.
RED_CHECK_EXIT=0
```

The gate passes it. Any new test file that imports anything the branch adds is automatically
crash-red, whatever it asserts — including nothing. The gate is therefore a check that a file
*mentions* new code, not that it *tests* it.

This matters here specifically because crash-red is not an edge case, it is the norm. Counting the
retained gate output in `docs/ai/gate-runs/`:

| Ticket | assertion-red | crash-red |
| --- | --- | --- |
| MIO-001 | 0 | 8 |
| MIO-002 | 0 | 3 |
| MIO-003 | 1 | 4 |
| MIO-004 | 0 | 2 |
| MIO-007 | 1 | 5 |
| MIO-008 | 0 | 2 |
| **Total** | **2** | **24** |

**24 of 26 recorded verdicts (92%) are the mode in which the gate proves almost nothing.**

To be fair to the author: `red-check.mjs:26-29` and `:199-201` say crash-red "proves less", and
`docs/ai/evidence-log.md:96-99` discloses it in the honest-limits section. That disclosure is why
this is a blocker about *the claim* rather than about concealment. But the disclosure says "proves
less"; it does not say "the gate passes `expect(1).toBe(1)`", and `AGENTS.md` rule 2 states the
guarantee absolutely. For a submission graded on engineering judgment, the gap between the
headline and the demonstrated behaviour is the thing a reviewer will find, so it is better to
narrow it first. The cheapest honest fix is to make crash-red **non-passing by default** for a new
test file — require at least one assertion-red file per ticket, or require an explicit
`crash-red-accepted:` declaration per path, the way green already requires `red-check-exempt:`.

---

## Should-fix

### S1 — The classifier reports its *strongest* verdict for a run that never reached an assertion

`scripts/red-check.mjs:142-149`

`hardCrash` (line 142) covers only missing modules, relations, schemas and columns. A crash of any
other shape falls through to line 147, where the `assertion` regex (line 131) matches `toBe` /
`toEqual` / `assert` **in the code frame vitest prints**, and the verdict becomes `assertion-red`.

Measured on a synthetic branch adding a new export to an **existing** file (so the import
resolves). At the merge-base vitest prints:

```
TypeError: brandNewHelper is not a function
      8|     expect(brandNewHelper(21)).toBe(42);
 Tests  1 failed (1)
```

and `red-check` reports:

```
✓  assertion-red  src/modules/probe2/__tests__/crash.spec.ts
```

The run never evaluated an expectation; the gate claims the proof it tells reviewers to prefer.
`docs/ai/evidence-log.md:56` lists this exact defect as *found and fixed* ("`red-check` reported
**assertion-red** for runs that never reached an assertion"). The fix is incomplete: `TypeError`,
`ReferenceError`, `is not a function` and `is not defined` are all in the `crash` pattern at line
132 but absent from `hardCrash` at 142. And none of the four `red-check` probes in
`scripts/gate-probes.mjs:319-373` covers this direction — probe
`a-missing-table-is-crash-red-not-a-missing-environment` pins only the `relation does not exist`
case. This is the task's "a probe that would pass even if its gate were broken", concretely.

### S2 — The RLS policy census is blind to a new schema; an ungoverned tenant table passes everything

`src/platform/db/__tests__/row-level-security.integration.spec.ts:92` and
`db/migrations/0010_row_level_security.sql:55`

Both the migration's policy loop and S7's census hardcode the same five schemas
(`identity, ingestion, gamification, ledger, rewards`). S7 is otherwise genuinely well built — it
derives its table list from `pg_class` rather than a literal list, so a new *table* in an existing
schema is caught (this is real; see verified claims). But a new *module* means a new
`pgSchema(...)`, and nothing covers it.

**Concrete, and executed.** I added one migration — a new module's schema, exactly as a developer
would copy the pattern:

```sql
create schema if not exists promotions;
create table promotions.campaign (
  tenant_id text not null, id text not null, name text not null,
  primary key (tenant_id, id));
grant usage on schema promotions to mio_app;
grant select, insert, update on promotions.campaign to mio_app;
```

No RLS, no policy, full read/write for the application role, every tenant's rows visible to every
tenant. Result:

```
row-level-security.integration.spec.ts   7 passed (7)
full suite                               32 files, 221 tests passed
arch-check                               PASS
```

Nothing in the repository notices. `docs/reliability.md:16` claims the opposite in terms:
*"S7 enumerates every `tenant_id` table from the catalogue so a new one without a policy fails."*
It enumerates every such table **in five named schemas**. Deriving the schema list from
`architecture.yaml`'s modules, or asserting over every non-system schema, closes it.

### S3 — The operator HTTP call does run inside an open database transaction, on the first attempt

`src/platform/db/unit-of-work.ts:29-41`, `src/modules/rewards/rewards.module.ts:55,85`

`UnitOfWork.withTransaction` is deliberately re-entrant: a nested call joins the outer transaction.
`IssueRedemptionConsumer` and `IssueRewardUseCase` are both injected the **same** `UnitOfWork`
singleton (`rewards.module.ts:55` and `:85`), and the consumer wraps `handle()` in a transaction
(`idempotent-consumer.ts:50`). So on the event-driven first attempt, `issue.execute`'s
`withTransaction` calls are no-ops that join the consumer's transaction, and the outbound HTTP call
at `issue-reward.usecase.ts:63` executes with that transaction open.

**Measured**, not inferred — a probe that records `uow.inTransaction()` at the moment of the
operator call and then asserts `observed === [true]`:

```
P2 — on the first attempt the operator HTTP call runs inside an open transaction   ✓ passed
```

Three pieces of prose say this must not happen:

- `issue-reward.usecase.ts:20-24`: *"The external call is deliberately NOT inside a transaction: an
  HTTP call in a transaction holds a database connection for as long as someone else's timeout."*
- `rewards/AGENTS.md:8-10`: *"The external call is never inside it."*
- `redeem.usecase.ts:12-15`, same reasoning.

The stated harm is real: with `ISSUANCE_TIMEOUT_MS` at 2000, a pool of 10 (`database.ts:23`) and a
slow operator, the worker holds a connection per in-flight issuance for up to two seconds. The
retry path is correct; only the first attempt is affected, which is why no test caught it. Either
the use case must open its transactions on a unit of work the consumer does not share, or the
consumer must commit its claim before calling `handle()` — and the prose must say which.

### S4 — `FOR UPDATE` on the balance row is unproven, and the named proof does not cover it

`src/modules/ledger/adapters/out/ledger.repository.ts:62-67`

Mutant **M1** deleted `for update` from the balance read. **221/221 still green.**

`docs/reliability.md:15` names this mechanism and its proof together: *"`CHECK (coins >= 0)` …
with `SELECT … FOR UPDATE` serialising concurrent debits | `ledger.integration.spec.ts` … S6 (two
concurrent debits of 60 against 100 end at 40)"*. S6 is a genuine concurrency test, but it passes
without the lock, because the loser is then rejected by the `CHECK` when its `coins = coins + delta`
re-evaluates against the committed row. S6 asserts only `status === 'rejected'`
(`ledger.integration.spec.ts:123`), never *which* error.

So removing the lock does not lose money — the architecture's own position (ADR-0005) is that the
`CHECK` is the invariant — but it silently converts the loser's friendly `422`
(`ledger.facade.ts:41`) into a constraint-violation `500`, and nothing notices.
`ledger/AGENTS.md:15-16` is candid that *"removing it does not break a single-threaded test"*; the
gap is that it does not break the concurrent one either. S6 should assert the rejection is
`UnprocessableError` with `extensions.balance`.

### S5 — An off-by-one in the overdraft guard survives: a player cannot spend their exact balance

`src/modules/ledger/application/ledger.facade.ts:40`

Mutant **M2** changed `if (balance < movement.coins)` to `<=`. **221/221 green.**

Under that mutation a player holding exactly 100 coins cannot buy a 100-coin item: the debit is
refused with `insufficient-balance` although the balance is sufficient. No test anywhere spends a
player's entire balance — every fixture tops up 500 and spends 100, or credits 100 and debits 40/60.
The boundary of the one comparison that decides whether a purchase is affordable is untested. One
test (`debit(exact balance)` → succeeds, balance 0) closes it.

### S6 — The attempt budget's boundary is unproven

`src/modules/rewards/application/issue-reward.usecase.ts:81`

Mutant **M20** changed `attempts >= this.options.maxAttempts` to `>`. **221/221 green.** The
system would make one more operator call than `ISSUANCE_MAX_ATTEMPTS` permits before refunding.
`MIO-010.md:43` (S6, *"attempts are bounded, and exhaustion refunds"*) and
`docs/reliability.md:13` (S5, *"fails twice then recovers ends `issued` with `attempts: 2`"*) both
exercise the inside of the range, never the edge. A test that exhausts the budget and asserts the
exact number of operator calls would pin it.

### S7 — The idempotency re-read is unscoped-tolerant, and the suite that covers it runs with RLS off

`src/modules/ledger/adapters/out/ledger.repository.ts:44-48`

Mutant **M4** replaced `and(scopedWhere(entry), eq(entry.idempotencyKey, …))` with the bare key
predicate. **221/221 green.** With the mutation, a conflicted insert can read back *another*
tenant's entry (the query has no ordering) and return its id, player and amount to the caller.

At runtime row-level security would prevent the cross-tenant read, because the application connects
as `mio_app`. But the suite cannot see that, because `ledger.integration.spec.ts:21` builds its own
database on `testDb.url` — **the owner** — so RLS is not in force for any of the ledger's own
tests. The clause is correct; it is simply unguarded in the only suite that exercises the path.

### S8 — Tenant isolation at the database layer rests on exactly one file

`src/platform/db/__tests__/row-level-security.integration.spec.ts`

Mutant **M10** removed `enable row level security` for every table. Exactly six tests died — S1,
S2, S3, S4, S5 and S7 of the RLS spec. **Not one module isolation test failed.** Seven suites
build their database on the owner URL and therefore cannot observe the policy layer at all:

```
identity/__tests__/identity-isolation.integration.spec.ts     ← named "isolation"
identity/__tests__/identity.integration.spec.ts
ledger/__tests__/ledger-isolation.integration.spec.ts         ← named "isolation"
ledger/__tests__/ledger.integration.spec.ts
platform/audit/__tests__/audit-log.integration.spec.ts
platform/db/__tests__/unit-of-work.integration.spec.ts
platform/events/__tests__/outbox.integration.spec.ts
```

The 12 suites going through `startTestApi` do run as `mio_app`, so the HTTP surface is covered, and
the three-layer design means one file owning the policy proof is defensible. It is worth saying
plainly only because of S2: that single point of proof has a hole, and two files named
`*-isolation*` would pass if the database layer did not exist.

### S9 — The "a facade may not re-export an adapter" rule is bypassed by the wiring file, and the repo uses the bypass

`eslint.config.mjs:85-99`, `src/modules/rewards/rewards.module.ts:112`,
`src/modules/gamification/gamification.module.ts:78`

The facade policy (lines 85-89) exists for a stated reason: *"it may not re-export an adapter,
which would turn the public surface of the module into its implementation."* The wiring policy
(lines 91-99) allows `*.module.ts` to import its own adapters — correct for Nest — and because
`boundaries/dependency-nodes` includes `'export'`, it equally allows **re-exporting** them.

**Measured.** I appended the identical line to both files:

```
src/modules/ledger/index.ts
  3:34  error  There is no policy allowing dependencies from file of category "facade" … to
               elements of type "module-adapter-out"    boundaries/dependencies
✖ 1 problem
```

`ledger/index.ts` is caught. The same re-export in `ledger.module.ts` produces **no error**. And
this is not hypothetical: both existing modules already use the door, and `main.worker.ts:4,6`
imports through it:

```
gamification.module.ts:78  export { DepositObservedConsumer } from './adapters/in/…';
rewards.module.ts:112      export { IssueRedemptionConsumer }  from './adapters/in/…';
```

So two adapter classes are part of the modules' public surface, reached by a composition root, with
the rule that forbids exactly this enforced only on the other file. Either restrict re-exports from
`*.module.ts` as well (and expose consumers some other way), or amend the comment to say the
wiring file is a second, deliberate public door. Right now the code and its stated rule disagree.

### S10 — `TD-0010` is cited as load-bearing justification in three live places and does not exist

`docs/tech-debt.md` defines TD-0001…0006, TD-0008, TD-0009. **TD-0007 and TD-0010 are absent.**
TD-0010 is nonetheless cited as the reason for a security decision:

- `db/migrations/0010_row_level_security.sql:17-18`: *"TD-0010 said the real control over an
  append-only table is privilege rather than a trigger; this is it."*
- `docs/specs/MIO-011.md:28-29`: *"The append-only tables lose `DELETE` and `TRUNCATE` from the
  application role — which is what TD-0010 said the real control was."*
- `src/modules/gamification/__tests__/wheel-admin.integration.spec.ts:38-39`: *"The real production
  control is that the application role holds no TRUNCATE privilege — see TD-0010 and MIO-011."*

A reader following the citation finds nothing. `pnpm docs-links` checks relative markdown links,
not identifiers, and `evidence-log.md:100-103` concedes there is no branch audit — so this is
precisely the class the repository admits it cannot catch, and it is present. Either write the row
or drop the citations.

### S11 — Three checkable claims in the evidence log are wrong, and the missing evidence is exactly the money and isolation work

`docs/ai/evidence-log.md`

| Line | Claim | Measured |
| --- | --- | --- |
| 32 | "**15 specs** with numbered, testable statements" | `ls docs/specs` → **13** (MIO-001…013). MIO-000 and MIO-014 have no spec |
| 34-35 | "**every ticket** has a `spec(...)`, a `test(...)` and a `feat(...)` commit in that order" | False for 3 of 15: **MIO-000** has `chore/feat/fix` only, **MIO-013** has no `test(...)` commit, **MIO-014** has only `docs(...)` |
| 91 | "the gates above, **re-run on every ticket, with the raw output kept**" | `docs/ai/gate-runs/` holds output for **6** tickets: MIO-001, 002, 003, 004, 007, 008 |

The third is the one that matters. The eight tickets with no retained gate output are MIO-005, 006,
**009, 010, 011**, 012, 013, 014 — that is, the bonus store, reward issuance and tenant isolation:
the three tickets a reviewer would most want red-check evidence for, and the two whose tests I was
able to break without the suite noticing (B2, S6). I also checked the cards: no card in
`board/5-done/` contains a `red-check:` block, so the evidence is not there either. For a Part D
deliverable whose thesis is "the gates were real and the output was kept", claiming coverage that
the directory does not show is the costliest kind of error in the document.

### S12 — `AGENTS.md` understates `pnpm verify` by four gates, including two that change how an agent works

`AGENTS.md:41` describes verify as *"lint + typecheck + unit + integration + build + arch-check +
board:check"* — seven steps. `scripts/verify.mjs:8-23` runs **eleven**, additionally:
`docs-links`, `spec-gate`, `test-guard` and `smoke`.

This is the canonical agent instruction file, and the omission is material: an agent reading it
does not know that `verify` already runs `spec-gate` and `test-guard`, so it will either run them
redundantly or assume they were skipped. The repository's own rule 10 ("update the prose you
invalidate, in the same commit") applies to this file.

### S13 — `test-guard`'s escape hatch accepts any sentence, and was used for things that are not spec conflicts

`scripts/test-guard.mjs:63-67`

The gate's only quality check on a `spec-conflict:` declaration is `found.reason.length < 15`. Any
15 characters pass. The retained output for MIO-007 (`docs/ai/gate-runs/MIO-007-review-request.txt:32-34`)
shows three declarations, of which at least two are not spec conflicts:

> *"the cleanup used DELETE on `infra.audit_log`, which the append-only trigger refuses by design
> (TRUNCATE is not blocked — TD-0010), and the `body: unknown` annotation did not typecheck against
> supertest's signature. **No assertion changed.**"*

> *"extended with S11; the file was written for MIO-006 and the spin's isolation case belongs beside
> it rather than in a third file"*

`AGENTS.md:16-18` defines the trailer as what you commit *"if the spec is wrong"*, and
`test-guard.mjs:23-26` says it *"sends the ticket back to the spec phase"*. Neither of these did —
one was a test-fixture bug, the other was adding a test. Using the hatch for test maintenance is
reasonable in itself, but it means the signal is noise: three "the ticket goes back to the spec
phase" warnings were raised and none was a spec disagreement. Separate the two cases
(`test-fix:` vs `spec-conflict:`) so the one that matters stays legible.

---

## Nits

- **N1** `docs/reliability.md:9` credits `FOR UPDATE SKIP LOCKED` in the entitlement claim.
  Mutant **M14** removed it: 221/221 green. The `state = 'granted'` predicate is what carries the
  guarantee — mutant **M13** removed *that* and the suite went red, which is the right outcome. The
  mechanism is correctly described as a pair; only the `SKIP LOCKED` half is redundant for
  correctness (it matters for throughput under many workers).
- **N2** `src/modules/gamification/application/spin.usecase.ts:66-74` computes the balance it
  returns as `balanceOf() + coins` rather than reading the balance after the credit. Correct today
  because `spin:<uuid>` is always a fresh key, so the credit always applies — but it is a
  re-derivation of something the ledger already returned, and it would silently report a wrong
  balance the day the key is not fresh.
- **N3** `db/migrations/0010_row_level_security.sql:17-19` says the grants are *"Read and write, but
  nothing that removes history."* `update` **is** granted on every table including `ledger.entry`,
  `gamification.spin`, `gamification.wheel_version` and `infra.audit_log`, and an UPDATE on an audit
  row destroys history as surely as a DELETE. What actually refuses it is the append-only trigger
  (`infra.refuse_mutation`), which mutant **M9** confirms is load-bearing. The comment credits
  privilege for something the trigger does — the reverse of the claim it makes two lines earlier.
- **N4** `infra.audit_log` is tenant data, has a policy (`0010:102-105`) and is correctly scoped,
  but schema `infra` is outside S7's census, so its policy is the one that is never re-verified.
- **N5** `docs/ai/evidence-log.md:10` says *"four of them were dead on the first run"*. The table
  below it lists defects in six distinct gates (boundary lint, `spec-gate`, `arch-check`,
  `red-check`, `test-guard`, the board probes). "Four" may be counting something narrower, but the
  number is not derivable from the document.
- **N6** `scripts/gate-probes.mjs` leaks a worktree when a run is interrupted. It does clean up —
  `rmSync(WT)` plus `git worktree prune` at `:481-482` — but not in a `finally`, so a probe that
  throws or is killed leaves `.tmp/probe-wt-<pid>` registered, each holding a full checkout and
  pinning an otherwise-unreachable commit. **Reported with a correction:** at the start of this
  review `git worktree list` showed four such registrations (`probe-wt-40788/47261/52455/56247`)
  and their directories existed. They are gone now, and I cannot rule out my own
  `git worktree prune` during cleanup as the cause, so the observation is not reproducible from
  this report. The code fact above stands on its own; the four stale entries should be treated as
  a sighting I can no longer evidence. A `try/finally` around the probe body fixes the class.


---

## Open questions — findings I could not make concrete

Per the review skill's own rule, these are questions, not findings.

- **Q1 — Are the surviving redundant predicates intended as defence in depth?** Four survivors are,
  as far as I can tell, *semantically* no-ops rather than defects, and I want to say so explicitly
  rather than pad the list: **M16** (tenant predicate dropped from the entitlement claim) and
  **M18** (tenant predicate dropped from `claimForIssuance`) survive because `player_id` and
  `redemption.id` are globally unique UUIDs, so the tenant clause selects nothing extra; **M27**
  (relay claim without `SKIP LOCKED`) survives because a second relay blocks and then re-evaluates
  the predicate against the claimed row. I believe all four clauses are correctly kept, and that no
  test distinguishing them is needed. Confirming that is a design question for the author, not a
  defect I can demonstrate.
- **Q2 — Is `issuing` meant to be recoverable at all?** B1 is a blocker on the assumption that a
  wedged redemption should heal itself. If the intended answer is "an operator calls support", that
  is a legitimate design for a slice — but then `rewards/AGENTS.md:17` must stop claiming a refund,
  `scaling.md:25` must alert on `issuing`, and it belongs in `docs/tech-debt.md`. No ADR addresses
  it either way.
- **Q3 — Is the owner/app split across test suites deliberate?** S8 describes it; the
  `api.helper.ts:26-29` comment suggests the HTTP suites were made app-role **on purpose**, which
  implies the repository-level suites were left on the owner equally on purpose. If so, the two
  files named `*-isolation*` that cannot see RLS are a naming problem rather than a coverage one.

---

## Claims I verified, and how

Reported in both directions, including where I expected damage and found none.

### Verified true

| Claim | How I checked it | Result |
| --- | --- | --- |
| `CHECK (coins >= 0)` on `ledger.balance` is the real invariant | mutant M7 weakened it to `check (true)` | **Killed**, by exactly one test: `S4 — the database refuses a negative balance on a direct update` |
| `UNIQUE (tenant_id, idempotency_key)` on entries is load-bearing | mutant M8 dropped it | **Killed**, 36 tests |
| Entries are append-only by trigger, not prose | mutant M9 removed the trigger | **Killed**, by exactly `S7 — entries are append-only` |
| RLS policies are real and exercised as the application role | mutant M10 removed `enable row level security` | **Killed**, RLS spec S1-S5, S7. The spec connects as `mio_app` (`:26`), seeds as owner (`:28-35`) — the assertions are meaningful |
| S7's census derives its table list from the catalogue, not a literal list | read `:87-96`; it queries `pg_class`/`pg_attribute` | **True** — a new table in an existing schema is caught. (A new *schema* is not: S2) |
| The tenant must enter context before the transaction opens | mutant M24 removed `set_config` | **Killed**, 55 tests |
| `SET LOCAL`, not session `SET` | mutant M25 flipped the third argument to `false` | **Killed** |
| `scoped()` has no un-scoped accessor and throws rather than defaulting | mutant M23 made the predicate a tautology | **Killed** |
| Consumers are idempotent by construction | mutant M26 removed the early return | **Killed**, by `S11 — the same event delivered twice performs the effect once` and `S12 — the effect and the processed-event record commit together` |
| Nothing the client sends influences the draw | mutants M11 (`uniform01` constant) and M12 (`Math.random()`) | **Both killed** |
| An entitlement leaves `granted` exactly once | mutant M13 dropped the state predicate | **Killed** |
| Entitlement expiry is in the claim predicate | mutant M15 dropped it | **Killed** |
| HMAC verification and the replay window are enforced | mutants M29 (always verify) and M30 (ignore the window) | **Both killed** |
| The refund is keyed per redemption, not per attempt | mutant M22 made the key per-attempt | **Killed** |
| A terminal failure is not retried | mutant M21 | **Killed** |
| The refund on exhaustion exists | mutant M19 removed it | **Killed** |
| `ON CONFLICT DO NOTHING` + a following read is safe under READ COMMITTED (`ledger/AGENTS.md:22-26`, `ledger.repository.ts:12-21`) | direct two-transaction probe | **True, and my counter-hypothesis was wrong.** The insert **waits** on the concurrent uncommitted conflicting row (measured 558ms against a 600ms gate); if that transaction rolls back the insert succeeds, if it commits the following read sees the row. I also probed the same idiom on the first-ever `ledger.balance` row and on `infra.processed_event`: **no money lost, no effect skipped** |
| Each card carries its phase log and its review findings (`evidence-log.md:29`) | grepped all 15 cards | **True** — 15/15 have both |
| `pnpm verify` is green at `3ef063e`, and the suite is green | ran the full suite | **True** — 32 files, 221 tests, 15.6s |
| The boundary lint is alive, not decoration | planted an adapter re-export in a facade | **Caught** — a real `boundaries/dependencies` error (and see S9 for the door it does not cover) |

**The category that came back clean.** I was asked to look hardest for "invariants that are only
prose". I read all eleven migrations against every money- and isolation-shaped claim and then tried
to break each constraint by hand. The four load-bearing ones — `CHECK (coins >= 0)`,
`UNIQUE (tenant_id, idempotency_key)`, the append-only triggers, and the RLS policies — are all
really in the database, all really exercised, and each is killed by a *narrowly targeted* test with
a message that names the problem. `gamification.spin.entitlement_id` carrying a `UNIQUE`
(`0008:9`) is the right place for "one spin per entitlement", and `ingestion.dedup`'s primary key
is the right place for deduplication. The exceptions the architecture names — RLS `ENABLE` rather
than `FORCE` so the owner can migrate, no policy on `infra.outbox`/`processed_event` for the relay,
the owner connection for the retry sweep — are each reasoned in the migration itself
(`0010:62-64`, `:96-98`) and each is genuinely needed, not convenient. This is the strongest part
of the repository and it is stronger than its documentation claims, not weaker.

### Claims I could not check, and why

- **The eight tickets with no retained gate output.** I cannot verify that `red-check`, `spec-gate`
  or `verify` ever ran for MIO-005, 006, 009, 010, 011, 012, 013, 014. The commit history shows the
  `spec → test → feat` ordering for most of them (which is consistent with the process having run),
  but the gate verdicts themselves are not recoverable after the fact: re-running `red-check` today
  needs each ticket's branch, and the branches were merged and are not retained. This is S11; I note
  it here as a limit on what *any* reviewer can confirm, not only me.
- **Whether the review phase found what it claims.** Each card has a `## Review findings` section,
  but `evidence-log.md:104-105` states the reviewer and the implementer were the same person. I can
  confirm the sections exist; I cannot confirm an independent read happened, and the log already
  concedes this.
- **Multi-process behaviour.** Everything I measured ran in one Node process against one Postgres.
  Two relay instances racing, a real worker crash (SIGKILL rather than a thrown error), and pool
  exhaustion under the S3 connection-holding are all argued above from code and single-process
  probes, not observed in a multi-process deployment. B1's probe simulates the crash by throwing at
  the operator call, which reproduces the *database state* a crash leaves but not the process death.
- **Docker.** I ran everything against the already-running `postgres:17-alpine` on 5440. I did not
  build the `Dockerfile` or bring up the full `docker compose` stack, so the `api`, `worker` and
  `casino-mock` services and the `dev` build target are unverified by me.
- **`pnpm gate-probes` as a whole.** I read `scripts/gate-probes.mjs` and probed `red-check`
  directly, but I did not run the full probe harness (it creates worktrees in the author's
  `.git`, which I avoided; see N6). The committed
  `final-gate-probes.txt` claims all probes pass; I verified the four `red-check` probes by
  reading them, and S1 is a gap in that set.
- **`pnpm smoke`.** Not run. It is in `verify` (`verify.mjs:22`) and its captured output is
  committed; I did not re-execute it.
- **One invalid mutant, disclosed.** My **M28** ("relay marks published before dispatching")
  survived, but the patch was my error — it appended a no-op statement without reordering anything,
  so it tested nothing. I am not counting it as a finding, and the question it was meant to ask
  (does anything notice if `markPublished` moves before dispatch?) remains unmeasured.

---

## Assessments requested

### Is `.claude/skills/review/SKILL.md` adequate?

Mostly yes, and better than most review checklists, because its four categories are ordered by
where agent-written code actually rots and because step 2 tells the reviewer to **mutate the
implementation by hand** rather than read for smells. Both of my sharpest findings (B2, S4) came
out of exactly that instruction. Its three "Rules" are the right three: verify the premise, scrutinise
your own remedy, report what you actually ran. The remedy rule earned its place — I formed three
confident hypotheses about `ON CONFLICT DO NOTHING` losing money and all three were wrong, and only
a direct probe showed it.

Four gaps, in the order I would fix them:

1. **"Pick two tests and mutate" is too few, and the skill does not say which two.** Two mutations
   chosen by a reviewer who has just read the implementation will land on code they already
   understand. Thirty mutations found ten survivors; the two that matter most (M17 behind B2, M2
   behind S5) are not ones I would have picked first. The skill should name the *targets* — every
   predicate in a conditional claim-UPDATE, every comparison in a money guard, every `scopedWhere`,
   every constraint named in a document — and require that the mutation be reverted and the whole
   suite run, not the file.
2. **It never asks whether a test fails for the mechanism it names.** Its vacuity test is "does a
   test fail", which both B2 mutations pass individually. The missing question is the one that
   caught B2: *delete the mechanism this test's name claims to prove, and does this test fail?* A
   test that survives deletion of its own subject is the sharpest available signal, and the skill
   does not ask for it.
3. **Step 3 ("re-run the ticket's own gates") implicitly trusts the gates.** The header says
   "Assume the gates passed — they did, or the ticket would not be here. Your job is what they
   cannot check." That framing is what lets B3 and S1 through: the reviewer is told the gate's
   verdict is a given, so nobody asks what `crash-red` is worth. The skill should require the
   reviewer to read the red-check *verdicts*, not just its exit code, and to treat an all-crash-red
   ticket as unproven.
4. **No instruction to check prose against the code.** Category four is "prose drift … does any ADR,
   spec, AGENTS.md or README now describe behaviour the diff changed", which scopes it to the diff.
   B1's false invariant and S10's dangling TD are not in any diff — they are drift that accumulated
   between tickets. The repository knows it has no branch audit; the review skill is the only place
   that could substitute, and it looks only at the branch.

### Do the 13 specs state observable behaviour?

Mostly yes. The specs are the strongest documentation here: statements are numbered, each names a
mechanism and an expected outcome, each carries a `Q`-and-answer section with the human's decision
recorded, and `AGENTS.md`'s convention that every test name starts with its `S`-id makes spec → test
a grep. I spot-checked MIO-008, MIO-010 and MIO-011 against their suites and the mapping holds
file-by-file.

Three qualifications:

- **Observable ≠ observed.** S10 (B2) is a statement about a mechanism — "the `pending_issuance →
  issuing` transition is a conditional UPDATE" — whose test cannot see that mechanism. The spec
  statement is observable in principle (count the operator's calls); the test does not do it. The
  same shape appears in MIO-010 S6 and reliability's S5 (S6 above): the statement names a bound, the
  test exercises the interior.
- **Some statements name an implementation rather than a behaviour.** "the transition is a
  conditional UPDATE" (MIO-010 S10) and "`FOR UPDATE SKIP LOCKED` in the sub-select"
  (reliability.md:9) are claims about *how*, which is why the tests drifted to proving *whether*.
  A statement phrased as "two concurrent issuances produce exactly one operator call" would have
  forced the test that is missing.
- **13, not 15**, and MIO-000 and MIO-014 have none — which is defensible (one is the pipeline
  itself, one is documentation) but is the source of the count error in S11.

### Is each Part C claim really proved by the test named beside it?

`docs/reliability.md` is a good table and most rows hold. Four do not:

| Row | Verdict |
| --- | --- |
| Duplicate deposit events | **Holds.** `ingestion.dedup` PK is real; S3 runs five concurrent deliveries |
| Concurrent spin requests | **Holds**, for the guarantee. The named proof over-specifies the mechanism — M13 (state predicate) kills, M14 (`SKIP LOCKED`) survives (N1) |
| Duplicate redemption requests | **Holds**, on a read of `0009:39` plus `redemption.integration.spec.ts:162`, which genuinely runs five concurrent duplicates. I did not mutate this constraint, so this row is read-verified, not mutation-verified |
| External API timeouts | **Holds.** S3 asserts the adapter's own timeout fired, by reason |
| Failed reward issuance | **Holds.** M21 (terminal retried) kills |
| Retries and eventual recovery | **Partly false.** "stored on the row so a restarted worker resumes" is true from `pending_issuance` and false from `issuing` — see **B1**. The named test (S5) only covers the former |
| No duplicate rewards | **Holds.** M8 and M22 both kill |
| No negative balances | **Overstated.** The `CHECK` is proved (M7 kills via S4). The `FOR UPDATE` half is not: M1 survives and the named proof S6 passes without it — see **S4** |
| Tenant isolation | **Overstated in one clause.** The three layers are real (M23/M24/M25/M10 all kill). "S7 enumerates every `tenant_id` table … so a new one without a policy fails" is false for a new schema — see **S2** |
| Invalid or unauthorized events | **Holds.** M29 and M30 both kill; the indistinguishable-401 claim is asserted in S4 |

The "preventing manipulation of the odds" section (lines 19-42) is the best-supported prose in the
repository: all four mechanisms are real, mutation-confirmed (M11, M12, M13, M15), and the
`What is not defended here` paragraph is honest and accurate.

### Does `docs/ai/evidence-log.md` overstate what the pipeline achieved?

**In its reasoning, no — in its facts, yes, and in one place in a way that matters.**

What it gets right is unusual and worth saying: the "What the gates caught" table is the most
valuable document here, the `Honest limits` section volunteers the crash-red weakness (lines 96-99),
the absence of a branch audit (100-103), and that the reviewer was the implementer (104-105). It
discloses its own central weakness before a reviewer can find it, which is the opposite of
overstatement. The specific defects it records are real: I independently re-derived the empty-string
`current_setting` trap from migration 0010, the `ON CONFLICT DO UPDATE` / append-only-trigger
collision from the ledger repository, and the consumer-scope ordering from
`idempotent-consumer.ts:39-46`.

Where it overstates:

1. **"re-run on every ticket, with the raw output kept"** (line 91) — six of fifteen, missing all
   three money and isolation tickets (S11). This is the one that matters, because it is the claim
   the whole document rests on, and the missing tickets are the ones where I found broken proofs.
2. **"15 specs"** (32) — thirteen. **"every ticket has a `spec`, a `test` and a `feat` commit"**
   (34-35) — false for three (S11).
3. **One defect is claimed fixed and is not.** Line 56 records that `red-check` *"reported
   assertion-red for runs that never reached an assertion"* and presents it as caught and
   corrected. It still does (S1), there is no probe for it, and the surrounding table is the
   document's argument that probing gates works. That is the single most self-undermining line in
   the file.
4. **"four of them were dead on the first run"** (10) — not derivable from the table (N5).

The honest summary: the *method* this log describes is real and the log is unusually candid about
its limits, but the log's own bookkeeping is the least verified artefact in the repository — which
is a precise instance of the thesis it argues, one layer up.

---

## What I would insist on before this is submitted

1. **B1** — the stuck `issuing` redemption. It is the only finding where a player loses money with
   no path to recovery, it reproduces deterministically, and a module `AGENTS.md` claims the
   opposite. Fix the recovery or fix the claim and the alert; do not ship both the hole and the
   sentence denying it.
2. **B2** — MIO-010 S10. A test that stays green when either of the two mechanisms that could make
   it green is deleted, guarding a money path, is the defect this repository's entire thesis is
   about. Count the operator's calls and race two real workers.
3. **B3 / S11** — bring the red-check rhetoric down to what the gate demonstrably does (it passes
   `expect(1).toBe(1)`), and correct the evidence log's three factual claims. The pipeline is the
   deliverable being graded; a reviewer who discovers the 24-of-26 crash-red ratio and the 6-of-15
   evidence gap on their own will discount the parts that are genuinely excellent — and most of it
   genuinely is.