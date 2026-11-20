-- rewards: the bonus store and the redemption lifecycle.

create schema if not exists rewards;

create table rewards.store_item (
  tenant_id  text        not null,
  item_id    text        not null,
  name       text        not null,
  price      integer     not null,
  reward     jsonb       not null,
  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, item_id),
  constraint store_item_price_positive check (price > 0)
);

-- A redemption copies the price and the reward payload at creation, for the same
-- reason a spin pins its wheel version: removing the item must not change a
-- redemption in flight (MIO-009 Q2).
create table rewards.redemption (
  id              uuid        primary key,
  tenant_id       text        not null,
  player_id       uuid        not null,
  item_id         text        not null,
  price           integer     not null,
  reward          jsonb       not null,
  status          text        not null default 'pending_issuance',
  -- Scoped to the tenant AND the player: one player's retry must never return
  -- another player's receipt.
  idempotency_key text        not null,
  attempts        integer     not null default 0,
  last_error      text,
  external_ref    text,
  next_attempt_at timestamptz,
  created_at      timestamptz not null,
  updated_at      timestamptz not null,
  constraint redemption_status_known
    check (status in ('pending_issuance', 'issuing', 'issued', 'failed')),
  constraint redemption_idempotent unique (tenant_id, player_id, idempotency_key)
);

create index redemption_player_idx on rewards.redemption (tenant_id, player_id, created_at desc);
create index redemption_due_idx on rewards.redemption (status, next_attempt_at);
