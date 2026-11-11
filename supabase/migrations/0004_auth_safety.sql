-- Apply after 0003. No customer rows are rewritten or removed.
alter table public.staff add column if not exists auth_version integer not null default 1;

create or replace function public.bump_staff_auth_version() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.pin_hash, new.active, new.brand_id, new.outlet_id, new.role)
    is distinct from (old.pin_hash, old.active, old.brand_id, old.outlet_id, old.role) then
    new.auth_version := old.auth_version + 1;
  end if;
  return new;
end $$;
create trigger staff_auth_changed before update on public.staff
for each row execute function public.bump_staff_auth_version();

create table public.auth_attempts (
  key_hash text primary key,
  window_started timestamptz not null,
  attempts integer not null
);
alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from anon, authenticated;
grant all on public.auth_attempts to service_role;
create index auth_attempts_cleanup on public.auth_attempts(window_started);

create or replace function public.consume_auth_attempt(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or length(p_key) <> 64 then return false; end if;
  insert into auth_attempts as a (key_hash, window_started, attempts)
  values (p_key, clock_timestamp(), 1)
  on conflict (key_hash) do update set
    attempts = case when a.window_started < clock_timestamp() - make_interval(secs => p_window_seconds) then 1 else least(a.attempts + 1, 1000000) end,
    window_started = case when a.window_started < clock_timestamp() - make_interval(secs => p_window_seconds) then clock_timestamp() else a.window_started end
  returning attempts into n;
  return n <= p_limit;
end $$;
revoke all on function public.consume_auth_attempt(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_auth_attempt(text, integer, integer) to service_role;

create table public.telegram_link_tokens (
  token_hash text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.telegram_link_tokens enable row level security;
revoke all on public.telegram_link_tokens from anon, authenticated;
grant all on public.telegram_link_tokens to service_role;
create index telegram_link_tokens_expiry on public.telegram_link_tokens(expires_at);

-- Consume and link in the SAME transaction; concurrent/replayed starts cannot relink.
create or replace function public.consume_telegram_link(p_hash text, p_chat_id bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if p_chat_id is null or p_chat_id <= 0 then return null; end if;
  delete from telegram_link_tokens where token_hash = p_hash and expires_at > clock_timestamp()
  returning customer_id into c;
  if c is null then return null; end if;
  update customers set telegram_chat_id = p_chat_id where id = c;
  return c;
end $$;
revoke all on function public.consume_telegram_link(text, bigint) from public, anon, authenticated;
grant execute on function public.consume_telegram_link(text, bigint) to service_role;
