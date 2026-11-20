-- ledger: the money-shaped invariants, as constraints.

create schema if not exists ledger;

-- Insert only. A correction is a compensating entry, never an edit.
create table ledger.entry (
  id              bigserial   primary key,
  tenant_id       text        not null,
  player_id       uuid        not null,
  direction       text        not null,
  coins           integer     not null,
  reason          text        not null,
  -- Derived from the cause: spin:<id>, redemption:<id>, redemption:<id>:refund.
  -- A caller who cannot name one is telling you the operation is not retryable.
  idempotency_key text        not null,
  created_at      timestamptz not null default now(),
  constraint entry_direction_known check (direction in ('credit', 'debit')),
  -- No signed amounts: a correction is a debit with a reason, so every aggregate
  -- over this table is free of sign conventions.
  constraint entry_coins_positive check (coins > 0),
  constraint entry_idempotent unique (tenant_id, idempotency_key)
);

create index entry_player_idx on ledger.entry (tenant_id, player_id, id desc);

-- The balance is a cached projection of the entries, and the CHECK is what makes
-- overdrawing impossible — not the application's own check, which is only there
-- to produce a friendly 422 (ADR-0005).
create table ledger.balance (
  tenant_id  text        not null,
  player_id  uuid        not null,
  coins      integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, player_id),
  constraint balance_never_negative check (coins >= 0)
);

create trigger entry_append_only
  before update or delete on ledger.entry
  for each statement execute function infra.refuse_mutation();
