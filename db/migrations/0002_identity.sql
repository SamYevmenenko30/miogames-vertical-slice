-- identity: who is calling, and whose player this is.

create schema if not exists identity;

create table identity.tenant (
  id         text        primary key,
  name       text        not null,
  -- Which operator dialect this tenant speaks. The only place the platform
  -- records that operators differ at all (ADR-0002).
  operator   text        not null,
  status     text        not null default 'active',
  created_at timestamptz not null default now(),
  constraint tenant_status_known check (status in ('active', 'suspended'))
);

-- The key id travels in the clear; the secret never does. A leaked database
-- yields no signing secrets.
create table identity.tenant_api_key (
  key_id        text        primary key,
  tenant_id     text        not null references identity.tenant (id) on delete cascade,
  secret_digest text        not null,
  active        boolean     not null default true,
  created_at    timestamptz not null default now()
);

create index tenant_api_key_tenant_idx on identity.tenant_api_key (tenant_id);

create table identity.player (
  id         uuid        primary key,
  tenant_id  text        not null references identity.tenant (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index player_tenant_idx on identity.player (tenant_id);

-- One operator player maps to exactly one of ours, per tenant. This unique
-- constraint is what decides a race between two first-sights of the same player
-- — not a prior read.
create table identity.player_identity (
  tenant_id          text        not null references identity.tenant (id) on delete cascade,
  external_player_id text        not null,
  player_id          uuid        not null references identity.player (id) on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (tenant_id, external_player_id)
);

create index player_identity_player_idx on identity.player_identity (player_id);
