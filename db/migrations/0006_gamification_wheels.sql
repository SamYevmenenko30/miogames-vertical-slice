-- gamification: the wheel, versioned. Nothing updates a live configuration —
-- an entitlement draws from the odds it was granted under (ADR-0004).

create schema if not exists gamification;

create table gamification.wheel (
  tenant_id  text        not null,
  id         text        not null,
  name       text        not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create table gamification.wheel_version (
  tenant_id  text        not null,
  wheel_id   text        not null,
  version    integer     not null,
  slices     jsonb       not null,
  created_by text        not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, wheel_id, version),
  foreign key (tenant_id, wheel_id) references gamification.wheel (tenant_id, id) on delete cascade,
  constraint wheel_version_positive check (version > 0)
);

-- A version is never rewritten: a rollback is a new version carrying the old
-- slices, so an entitlement pinned to a bad version still draws what it was
-- promised (MIO-006 Q1).
create trigger wheel_version_append_only
  before update or delete on gamification.wheel_version
  for each statement execute function infra.refuse_mutation();
