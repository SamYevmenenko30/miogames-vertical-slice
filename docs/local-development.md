# Local development

## First run

```bash
nvm use                 # Node 22
pnpm install
docker compose up -d    # postgres :5440, api :3000, worker, casino mock :3010
pnpm db:migrate         # migrations are explicit, never applied at boot
pnpm db:seed            # two tenants: casino-a and casino-b, with API keys printed
pnpm smoke              # drives the whole Part B flow end to end and prints each step
```

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

Two replicas starting at the same time race each other through the same migration. The deploy
applies migrations as its own step; the application only verifies that the schema version it
needs is present and refuses to start otherwise.

## Integration tests and the database

Each integration test file gets its **own** database, created from a template and dropped at the
end. Two reasons, both learned painfully elsewhere: a shared test database turns an unrelated
file's crash into your flake, and a half-applied migration in a shared database produces failures
that look like application bugs for hours. Cleaning happens on the way *in*, not only in
`afterEach`.

## Row-level security

The unit-of-work issues `SET LOCAL app.tenant_id` per transaction, and the tenant-owned tables
carry RLS policies against it. Migrations and the seed run as the table owner (which bypasses
RLS); the application connects as a non-owner role, so a query that escapes `scoped()` returns
nothing instead of another tenant's rows. If a test suddenly sees zero rows it should see, check
that it opened a transaction — outside one, there is no `app.tenant_id`.
