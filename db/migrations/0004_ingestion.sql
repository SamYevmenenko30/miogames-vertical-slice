-- ingestion: what an operator sent us, and whether we had seen it before.

create schema if not exists ingestion;

-- Stored for every AUTHENTICATED request, before interpretation and whatever the
-- outcome. An operator dispute is settled by what they sent, not by what we made
-- of it.
create table ingestion.envelope (
  id                 bigserial   primary key,
  tenant_id          text        not null,
  operator           text        not null,
  operator_event_id  text,
  raw                jsonb       not null,
  outcome            text        not null,
  event_id           uuid,
  error              text,
  received_at        timestamptz not null default now(),
  constraint envelope_outcome_known
    check (outcome in ('accepted', 'duplicate', 'invalid', 'unsupported'))
);

create index envelope_tenant_idx on ingestion.envelope (tenant_id, received_at desc);
create index envelope_operator_event_idx on ingestion.envelope (tenant_id, operator_event_id);

-- Deduplication is this constraint. Not a read followed by an insert, which
-- races with itself; the same operator event id in two tenants is two events.
create table ingestion.dedup (
  tenant_id         text        not null,
  operator_event_id text        not null,
  event_id          uuid        not null,
  created_at        timestamptz not null default now(),
  primary key (tenant_id, operator_event_id)
);
