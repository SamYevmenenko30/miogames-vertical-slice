-- Every spin, with everything a regulator needs to recompute it: the wheel
-- version it drew from, the seed, the seed's committed hash, the slice and the
-- prize (ADR-0004).

create table gamification.spin (
  id             uuid        primary key,
  tenant_id      text        not null,
  player_id      uuid        not null,
  entitlement_id uuid        not null unique,
  wheel_id       text        not null,
  wheel_version  integer     not null,
  server_seed    text        not null,
  seed_hash      text        not null,
  slice_id       text        not null,
  prize          jsonb       not null,
  coins_credited integer     not null default 0,
  spun_at        timestamptz not null
);

create index spin_player_idx on gamification.spin (tenant_id, player_id, spun_at desc);

-- A spin is a historical fact.
create trigger spin_append_only
  before update or delete on gamification.spin
  for each statement execute function infra.refuse_mutation();
