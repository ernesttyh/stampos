-- Durable, at-most-once dispatch. "accepted" means provider API acceptance, NOT delivery.
-- Uncertain claims are NEVER automatically retried: reconcile with provider evidence.
create table public.messaging_claims (
  id uuid primary key default gen_random_uuid(),
  operation_key text not null unique,
  brand_id uuid not null references public.brands(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  trigger text not null,
  automatic boolean not null default false,
  sg_day date not null default (now() at time zone 'Asia/Singapore')::date,
  status text not null default 'uncertain' check(status in ('uncertain','accepted','skipped')),
  channel text check(channel in ('push','telegram','whatsapp')),
  error text,
  bonus_result jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index messaging_one_auto_daily on public.messaging_claims(customer_id, sg_day) where automatic;
create index messaging_cooldown on public.messaging_claims(customer_id, trigger, created_at desc);

create table public.messaging_campaign_recipients (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','uncertain','accepted','skipped')),
  error text,
  claimed_at timestamptz,
  primary key(campaign_id, customer_id)
);
create table public.messaging_auto_runs (
  brand_id uuid not null references public.brands(id) on delete cascade,
  sg_day date not null,
  created_at timestamptz not null default now(),
  primary key(brand_id, sg_day)
);
create table public.messaging_auto_recipients (
  brand_id uuid not null references public.brands(id) on delete cascade,
  sg_day date not null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  claimed_at timestamptz,
  primary key(brand_id, sg_day, customer_id),
  foreign key(brand_id, sg_day) references public.messaging_auto_runs(brand_id, sg_day) on delete cascade
);
alter table public.messaging_claims enable row level security;
alter table public.messaging_campaign_recipients enable row level security;
alter table public.messaging_auto_runs enable row level security;
alter table public.messaging_auto_recipients enable row level security;
revoke all on public.messaging_claims, public.messaging_campaign_recipients,
  public.messaging_auto_runs, public.messaging_auto_recipients from public, anon, authenticated;
grant all on public.messaging_claims, public.messaging_campaign_recipients,
  public.messaging_auto_runs, public.messaging_auto_recipients to service_role;

alter table public.rewards add column birthday_year integer;
create unique index messaging_birthday_year on public.rewards(customer_id, birthday_year)
  where type = 'birthday' and birthday_year is not null;

-- First caller snapshots the ENTIRE eligible audience in the same transaction as
-- draft -> sending. No PostgREST row limit / offset pagination can truncate it.
create function public.messaging_start_campaign(p_campaign_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c campaigns%rowtype; b brands%rowtype;
begin
  select * into c from campaigns where id = p_campaign_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  if c.status = 'draft' then
    select * into strict b from brands where id = c.brand_id;
    if c.bonus_stamps < 0 or c.bonus_stamps > 5 then raise exception 'Invalid campaign bonus'; end if;
    insert into messaging_campaign_recipients(campaign_id, customer_id)
    select c.id, u.id from customers u where u.brand_id = c.brand_id and u.marketing_consent
      and (u.push_subscription is not null or u.telegram_chat_id is not null or u.whatsapp_opt_in)
      and case c.segment
        when 'all' then true
        when 'near_reward' then u.stamp_balance >= b.stamps_per_reward - 2
        when 'lapsed_14' then u.last_visit_at < now() - interval '14 days'
        when 'lapsed_30' then u.last_visit_at < now() - interval '30 days'
        when 'influencers' then u.kind = 'influencer'
        when 'push_only' then u.push_subscription is not null
        when 'telegram_only' then u.telegram_chat_id is not null
        else false end;
    update campaigns set status = 'sending', audience = (select count(*) from messaging_campaign_recipients where campaign_id = c.id)
      where id = c.id returning * into c;
  end if;
  return to_jsonb(c);
end $$;

-- Claim only pending rows. Crashes leave uncertain rows, not retryable pending rows.
create function public.messaging_campaign_batch(p_campaign_id uuid, p_limit integer default 25)
returns setof uuid language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from campaigns where id = p_campaign_id and status = 'sending') then return; end if;
  return query with picked as (
    select r.customer_id from messaging_campaign_recipients r
    where r.campaign_id = p_campaign_id and r.status = 'pending'
    order by r.customer_id for update skip locked limit least(greatest(p_limit,1),25)
  ) update messaging_campaign_recipients r set status = 'uncertain', claimed_at = now()
    from picked p where r.campaign_id = p_campaign_id and r.customer_id = p.customer_id returning r.customer_id;
end $$;

create function public.messaging_finish_campaign(p_campaign_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_a integer; v_p integer; v_u integer; v_n integer;
begin
  perform 1 from campaigns where id = p_campaign_id for update;
  select count(*), count(*) filter(where status='accepted'), count(*) filter(where status='pending'),
    count(*) filter(where status='uncertain') into v_a,v_n,v_p,v_u
    from messaging_campaign_recipients where campaign_id = p_campaign_id;
  update campaigns set audience=v_a, delivered=v_n,
    status=case when v_p > 0 then 'sending' when v_u > 0 then 'failed' else 'sent' end,
    sent_at=case when v_p=0 then now() else null end where id=p_campaign_id;
  return jsonb_build_object('audience',v_a,'accepted',v_n,'delivered',v_n,'pending',v_p,'uncertain',v_u,
    'status',case when v_p>0 then 'sending' when v_u>0 then 'failed' else 'sent' end);
end $$;

-- Serializing on the customer protects daily and cooldown checks across EVERY
-- automatic source (including windows and creator reminders). Bonus and claim
-- commit together; the unique operation key makes any credit exactly once.
create function public.messaging_claim(
  p_customer_id uuid, p_brand_id uuid, p_operation_key text, p_trigger text,
  p_campaign_id uuid default null, p_automatic boolean default false,
  p_cooldown_days integer default 0, p_bonus integer default 0, p_bonus_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c customers%rowtype; v_id uuid; v_bonus jsonb; v_key text; cp campaigns%rowtype;
begin
  select * into c from customers where id=p_customer_id and brand_id=p_brand_id for update;
  if not found or not c.marketing_consent then return null; end if;
  if c.push_subscription is null and c.telegram_chat_id is null and not c.whatsapp_opt_in then return null; end if;
  if p_bonus < 0 or p_bonus > 5 then raise exception 'Invalid messaging bonus'; end if;
  if p_campaign_id is not null then
    select * into cp from campaigns where id=p_campaign_id and brand_id=p_brand_id;
    if not found then raise exception 'Campaign brand mismatch'; end if;
    if not exists(select 1 from messaging_campaign_recipients where campaign_id=p_campaign_id
      and customer_id=c.id and status='uncertain') then return null; end if;
    v_key := 'campaign:' || p_campaign_id || ':' || c.id;
    if p_bonus <> cp.bonus_stamps then raise exception 'Campaign bonus mismatch'; end if;
  else
    v_key := p_operation_key;
  end if;
  if v_key is null or length(v_key) > 300 then raise exception 'Invalid operation key'; end if;
  if p_automatic and exists(select 1 from messaging_claims where customer_id=c.id
    and automatic and sg_day=(now() at time zone 'Asia/Singapore')::date) then return null; end if;
  if p_cooldown_days > 0 and (
    exists(select 1 from messaging_claims where customer_id=c.id and trigger=p_trigger
      and created_at > now()-make_interval(days=>p_cooldown_days) and status <> 'skipped')
    or exists(select 1 from notifications where customer_id=c.id and trigger=p_trigger
      and status='sent' and sent_at > now()-make_interval(days=>p_cooldown_days))
  ) then return null; end if;
  insert into messaging_claims(operation_key,brand_id,customer_id,campaign_id,trigger,automatic)
    values(v_key,p_brand_id,c.id,p_campaign_id,p_trigger,p_automatic)
    on conflict do nothing returning id into v_id;
  if v_id is null then return null; end if;
  if p_bonus > 0 then
    v_bonus := add_stamps(c.id,p_bonus,'campaign',null,null,1,p_bonus_note,false);
    update messaging_claims set bonus_result=v_bonus where id=v_id;
  end if;
  return jsonb_build_object('id',v_id,'bonus',v_bonus);
end $$;

-- Independent entitlement pass: no marketing filter, and atomic annual issuance.
-- Existing birthday_reward_year is respected for rewards issued before migration.
create function public.messaging_issue_birthdays(p_brand_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare c customers%rowtype; b brands%rowtype; d date := (now() at time zone 'Asia/Singapore')::date;
  y integer := extract(year from d); n integer := 0;
begin
  select * into strict b from brands where id=p_brand_id;
  if not b.birthday_reward_enabled then return 0; end if;
  for c in select * from customers where brand_id=b.id
    and to_char(birthday,'MM-DD')=to_char(d,'MM-DD')
    and birthday_reward_year is distinct from y order by id for update
  loop
    insert into rewards(brand_id,customer_id,type,title,expires_at,birthday_year)
      values(b.id,c.id,'birthday','Birthday '||lower(b.reward_name),now()+interval '30 days',y)
      on conflict do nothing;
    if found then n:=n+1; end if;
    update customers set birthday_reward_year=y where id=c.id;
  end loop;
  return n;
end $$;

-- Daily durable audience includes non-consenting customers, but dispatch always
-- rechecks consent. Claiming a work item is final even on crash (at-most-once).
create function public.messaging_auto_batch(p_brand_id uuid, p_limit integer default 25)
returns setof uuid language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Singapore')::date;
begin
  perform 1 from brands where id=p_brand_id for update;
  insert into messaging_auto_runs(brand_id,sg_day) values(p_brand_id,d) on conflict do nothing;
  if found then
    insert into messaging_auto_recipients(brand_id,sg_day,customer_id)
      select p_brand_id,d,id from customers where brand_id=p_brand_id;
  end if;
  return query with picked as (
    select r.customer_id from messaging_auto_recipients r where r.brand_id=p_brand_id and r.sg_day=d and r.claimed_at is null
      order by r.customer_id for update skip locked limit least(greatest(p_limit,1),25)
  ) update messaging_auto_recipients r set claimed_at=now() from picked p
    where r.brand_id=p_brand_id and r.sg_day=d and r.customer_id=p.customer_id returning r.customer_id;
end $$;

-- Explicit ACLs: SECURITY DEFINER must NEVER inherit PUBLIC execution.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('messaging_start_campaign','messaging_campaign_batch',
      'messaging_finish_campaign','messaging_claim','messaging_issue_birthdays','messaging_auto_batch')
  loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
