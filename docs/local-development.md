# Local development

## First run

```bash
nvm use                 # Node 22
pnpm install
docker compose up -d    # postgres :5440, api :3000, worker :3002, casino mock :3010
pnpm db:migrate         # migrations are explicit, never applied at boot
pnpm db:seed            # two tenants: casino-a and casino-b, with API keys printed
pnpm smoke              # drives the whole Part B flow end to end and prints each step
```

`docker compose up -d` is the containerised path, and it is checked rather than assumed: the
build was run from a clean context, and with the stack up, `POST /v1/ingest/casino-a/events`
without a signature answers `401 signature.invalid` as `application/problem+json`, while
`:3002/health` and `:3010/health` answer `200`. `pnpm smoke` deliberately does **not** go through
these containers — it boots its own composition on a database of its own, so that a green smoke
run is never an accident of what happens to be running locally.

A `.dockerignore` keeps the host's `node_modules` out of the build context. Without it the context
is ~300MB of the wrong platform's binaries, and `docker compose build` takes minutes instead of
seconds.

Everything also runs without Docker except the integration tests and the smoke run, which need
Postgres:

```bash
docker compose up -d postgres
pnpm test               # unit + integration
pnpm test:unit          # no I/O, runs anywhere
```

## Ports

| Service | Port | Why this one |
| --- | --- | --- |
| api | 3000 | |
| casino mock (operators A and B) | 3010 | |
| Postgres | **5440** | 5432 and 5433 are commonly already taken by another local stack |

## Why migrations never run at boot

**`0011` does not exist, and that is not a missing file.** The number was skipped while the review
rounds were landing and never reused. The runner records what it applied by filename, so a gap in
the sequence is inert — whereas renumbering a migration that has already run in someone's database
is how a cosmetic gap becomes a real one.

Two replicas starting at the same time race each other through the same migration. So the deploy
applies migrations as its own step, and `pnpm db:migrate` is the only thing that ever applies one.

What the application does about it is narrower than this paragraph used to claim — it said the
application "only verifies that the schema version it needs is present and refuses to start
otherwise", and it does neither. `src/main.api.ts` creates the app and listens; there is no
required-version constant and no refusal. What exists is `GET /health`, which **reports** the
newest applied version and answers 503 if it cannot read the migrations table, and
`HealthController`'s own comment is the accurate description: "this endpoint reports what was
applied, so a wrong answer is visible rather than silently corrected". Started against an
unmigrated database the api listens and serves `{"ok":false,"schemaVersion":null,"role":"api"}`,
which is what an orchestrator's readiness probe is for. A real deployment would add the refusal —
it is one
constant and one query — and until it does, this paragraph says what the code does.

## Integration tests and the database

Each integration test file gets its **own** database, created from a template and dropped at the
end. Two reasons, both learned painfully elsewhere: a shared test database turns an unrelated
file's crash into your flake, and a half-applied migration in a shared database produces failures
that look like application bugs for hours. Cleaning happens on the way *in*, not only in
`afterEach`.

## Row-level security

The unit of work issues `SET LOCAL app.tenant_id` per transaction, and the tenant-owned tables
carry policies against it. Migrations and the seed run as the owner (`DATABASE_OWNER_URL`), which
bypasses RLS; the application connects as `mio_app`, so a query that escapes `scopedWhere`
returns nothing instead of another tenant's rows.

Two things to know before this costs you an hour:

- **The tenant must be in context BEFORE the transaction opens.** `SET LOCAL` happens at `BEGIN`;
  entering the tenant scope inside the transaction leaves the database without a tenant for the
  whole of it, and every scoped query returns zero rows while looking perfectly correct. That is
  a real bug this repository had, in the event consumers, and RLS is what exposed it.
- **`current_setting('app.tenant_id', true)` returns the EMPTY STRING, not NULL, once the setting
  has been touched on that connection.** On a pooled connection the first request sees NULL and
  every later one sees `''`. The policies normalise with `nullif(..., '')`; a policy written
  against NULL alone starts refusing everything after the first request, including the credential
  lookup that precedes any tenant.

If a test suddenly sees zero rows it should see, check both of those before suspecting the query.
