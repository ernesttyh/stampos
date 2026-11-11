-- LOCAL TEST DATABASE ONLY. Run as a PostgreSQL superuser in stampos_test_db.
-- psql -v ON_ERROR_STOP=1 -d stampos_test_db -f tests/database_bootstrap.sql
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key, email text, raw_user_meta_data jsonb default '{}'
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
\ir ../supabase/migrations/0001_schema.sql
\ir ../supabase/migrations/0002_lock_down_rpc.sql
\ir ../supabase/migrations/0003_launch_safety.sql
