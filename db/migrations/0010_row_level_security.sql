-- The third layer of tenant isolation (ADR-0006): the database refuses.
--
-- Row-level security does NOT apply to a table's owner, so a policy written
-- against an owner connection is decoration. The application connects as
-- mio_app; migrations and the one deliberate cross-tenant job use the owner.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mio_app') then
    create role mio_app login password 'mio_app';
  end if;
end
$$;

grant usage on schema identity, ingestion, gamification, ledger, rewards, infra to mio_app;

-- Read and write, and DELETE only where a row is genuinely transient (below).
--
-- Be exact about what this buys, because an earlier version of this comment was
-- not: UPDATE is granted here on every table, the append-only ones included, so
-- privilege is NOT what refuses an UPDATE to ledger.entry, gamification.spin,
-- gamification.wheel_version or infra.audit_log -- the infra.refuse_mutation
-- trigger is, and an UPDATE destroys history as surely as a DELETE. Withholding
-- DELETE and TRUNCATE is the second half of that control, not the whole of it.
-- TD-0010 carries the remaining gap.
grant select, insert, update on all tables in schema identity, ingestion, gamification, ledger, rewards, infra to mio_app;
grant usage, select on all sequences in schema identity, ingestion, gamification, ledger, rewards, infra to mio_app;

-- Deleting is allowed only where a row is genuinely transient.
grant delete on identity.player, gamification.spin_entitlement, rewards.store_item,
                 ingestion.envelope, infra.outbox, infra.processed_event to mio_app;

-- New tables inherit the same shape, so a later migration cannot quietly create
-- an ungranted table and a privilege bug at the same time.
alter default privileges in schema identity, ingestion, gamification, ledger, rewards, infra
  grant select, insert, update on tables to mio_app;
alter default privileges in schema identity, ingestion, gamification, ledger, rewards, infra
  grant usage, select on sequences to mio_app;

-- Policies.
--
-- Note the `nullif(..., '')`. `current_setting('app.tenant_id', true)` returns
-- NULL only until the setting has been touched ONCE on that connection: after a
-- transaction has used `SET LOCAL`, the GUC exists and reads back as the EMPTY
-- STRING when unset. On a pooled connection that means the second request sees
-- '' where the first saw NULL — and a policy written against NULL alone starts
-- refusing everything, including the credential lookup that precedes any tenant.
-- That is how this was found: the first request on each connection worked and
-- every later one answered 401.
--
-- With the empty string normalised to NULL, a query with no tenant in context
-- returns nothing, which is the only safe default for a policy.
do $$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r'
       and n.nspname in ('identity', 'ingestion', 'gamification', 'ledger', 'rewards')
       and exists (
         select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'tenant_id'
            and a.attnum > 0 and not a.attisdropped
       )
  loop
    -- ENABLE, not FORCE: the owner connection is deliberately privileged — it
    -- runs migrations and the one cross-tenant sweep. FORCE would subject a
    -- non-superuser owner to the policies too and break both.
    execute format('alter table %I.%I enable row level security', target.schema_name, target.table_name);
    execute format(
      'create policy tenant_isolation on %I.%I '
      'using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')) '
      'with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), ''''))',
      target.schema_name, target.table_name
    );
  end loop;
end
$$;

-- identity.tenant is the partition ROOT: resolving "which tenant is this key" is
-- the step that establishes the tenant, so it cannot require one. Its policy
-- allows a row through when no tenant is set, and restricts to the tenant's own
-- row once one is.
drop policy if exists tenant_isolation on identity.tenant;
create policy tenant_isolation on identity.tenant
  using (nullif(current_setting('app.tenant_id', true), '') is null
         or id = nullif(current_setting('app.tenant_id', true), ''))
  with check (nullif(current_setting('app.tenant_id', true), '') is null
              or id = nullif(current_setting('app.tenant_id', true), ''));

-- Same for the credential lookup that precedes any tenant. The loop above
-- already enabled RLS on this table and gave it the strict policy, so replace it.
drop policy if exists tenant_isolation on identity.tenant_api_key;
create policy tenant_isolation on identity.tenant_api_key
  using (nullif(current_setting('app.tenant_id', true), '') is null
         or tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  with check (nullif(current_setting('app.tenant_id', true), '') is null
              or tenant_id = nullif(current_setting('app.tenant_id', true), ''));

-- infra.outbox carries a tenant id but is platform plumbing the relay reads
-- across tenants by design (MIO-011 Q2). No policy — stated here so the
-- exception is visible rather than discovered.
--
-- infra.processed_event is NOT an exception: it has no tenant_id column at all
-- (consumer + event_id is its whole key), so there is nothing to scope and it
-- never enters the policy census. An earlier version of this comment listed it
-- beside the outbox, which read as though a tenant-owned table had been let off.

-- infra.audit_log carries a tenant id and IS tenant data, so it gets a policy
-- too. The relay never reads it; the admin surface reads it scoped.
alter table infra.audit_log enable row level security;
create policy tenant_isolation on infra.audit_log
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''))
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
