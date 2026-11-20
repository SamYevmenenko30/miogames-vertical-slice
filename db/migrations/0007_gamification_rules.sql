-- Reward rules are DATA: a new rule is a row, a new rule TYPE is code.
-- Tiered by decision (Sam, 2026-11-20): the highest matching threshold wins and
-- only one rule applies.

create table gamification.reward_rule (
  tenant_id         text        not null,
  id                text        not null,
  min_deposit_minor integer     not null,
  currency          text        not null,
  wheel_id          text        not null,
  spins             integer     not null,
  ttl_hours         integer     not null default 168,
  active            boolean     not null default true,
  created_at        timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint reward_rule_threshold_positive check (min_deposit_minor > 0),
  constraint reward_rule_spins_positive check (spins > 0),
  constraint reward_rule_ttl_positive check (ttl_hours > 0)
);

-- An entitlement is one unspent spin. It pins the wheel VERSION it was granted
-- under and carries a server seed committed at grant time: the odds and the
-- outcome are both fixed before the player acts (ADR-0004).
create table gamification.spin_entitlement (
  id              uuid        primary key,
  tenant_id       text        not null,
  player_id       uuid        not null,
  wheel_id        text        not null,
  wheel_version   integer     not null,
  rule_id         text        not null,
  state           text        not null default 'granted',
  server_seed     text        not null,
  seed_hash       text        not null,
  source_event_id text        not null,
  granted_at      timestamptz not null,
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  constraint entitlement_state_known check (state in ('granted', 'consumed', 'expired'))
);

create index entitlement_claimable_idx
  on gamification.spin_entitlement (tenant_id, player_id, state, expires_at);
