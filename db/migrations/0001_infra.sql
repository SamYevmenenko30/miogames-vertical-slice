-- Platform tables. Everything here belongs to the platform, not to a module:
-- the outbox, the processed-event store, and the audit log.

create schema if not exists infra;

-- The transactional outbox. A use-case writes its state change and its outgoing
-- events in one transaction; the relay delivers them at least once.
create table infra.outbox (
  id              bigserial primary key,
  tenant_id       text        not null,
  name            text        not null,
  aggregate_type  text        not null,
  aggregate_id    text        not null,
  payload         jsonb       not null,
  occurred_at     timestamptz not null,
  created_at      timestamptz not null default now(),
  published_at    timestamptz,
  attempts        integer     not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null,
  claimed_at      timestamptz,
  claimed_by      text
);

-- The relay only ever looks for unpublished, due rows.
create index outbox_pending_idx
  on infra.outbox (next_attempt_at, id)
  where published_at is null;

-- Idempotent consumers. The row and the handler's effect commit together, so a
-- redelivery is a no-op and a crashed handler leaves no claim behind.
create table infra.processed_event (
  consumer     text        not null,
  event_id     text        not null,
  processed_at timestamptz not null default now(),
  primary key (consumer, event_id)
);

-- Append-only audit log: every configuration change and every money movement.
create table infra.audit_log (
  id           bigserial primary key,
  tenant_id    text        not null,
  actor        text        not null,
  action       text        not null,
  subject_type text        not null,
  subject_id   text        not null,
  data         jsonb       not null default '{}'::jsonb,
  recorded_at  timestamptz not null default now()
);

create index audit_log_tenant_idx on infra.audit_log (tenant_id, recorded_at desc);

-- Append-only is enforced by the database, not by the application. An audit log
-- an application can rewrite is not an audit log.
create or replace function infra.refuse_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only: % is refused', tg_table_name, tg_op;
end;
$$;

create trigger audit_log_append_only
  before update or delete on infra.audit_log
  for each statement execute function infra.refuse_mutation();
