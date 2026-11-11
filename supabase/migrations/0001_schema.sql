-- StampOS — multi-brand e-stamp loyalty platform
-- Run this in the Supabase SQL editor (or `supabase db push`).
-- All application access goes through the service role on the server; RLS is
-- enabled everywhere with no anon policies, so nothing is reachable with the anon key.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Brands (tenants)
-- ---------------------------------------------------------------------------
create table if not exists brands (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,                 -- /chengdu-bowl
  name             text not null,
  tagline          text,
  logo_url         text,
  primary_color    text not null default '#C8102E',      -- hex
  accent_color     text not null default '#F2B134',
  stamps_per_reward int  not null default 10,
  stamp_label      text not null default 'bowl',         -- "1 stamp per bowl"
  reward_name      text not null default 'Free bowl',
  reward_valid_days int  not null default 60,
  max_stamps_per_visit int not null default 6,
  migration_until  date,                                  -- staff may credit old physical cards until this date
  migration_cap    int  not null default 9,
  spin_enabled     boolean not null default true,
  spin_double_odds int  not null default 5,              -- 1-in-N chance of a bonus stamp after a stamp
  streak_enabled   boolean not null default true,
  referral_enabled boolean not null default true,
  install_bonus_enabled boolean not null default true,
  birthday_reward_enabled boolean not null default true,
  tiers            jsonb not null default '[
    {"name":"Rookie","min":0,"perk":"Welcome to the club"},
    {"name":"Regular","min":10,"perk":"Birthday reward unlocked"},
    {"name":"Local","min":30,"perk":"Early access to new menu items"},
    {"name":"Legend","min":60,"perk":"Secret menu unlocked — ask staff"}
  ]'::jsonb,
  ugc_agreement    text,                                   -- default influencer agreement text
  pdpa_text        text,
  timezone         text not null default 'Asia/Singapore',
  created_at       timestamptz not null default now()
);

create table if not exists outlets (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references brands(id) on delete cascade,
  name       text not null,
  address    text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists outlets_brand_idx on outlets(brand_id);

-- Staff log in with outlet + PIN on the scanner (no email needed)
create table if not exists staff (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references brands(id) on delete cascade,
  outlet_id  uuid references outlets(id) on delete set null,   -- null = any outlet of the brand
  name       text not null,
  pin_hash   text not null,                                     -- bcrypt
  role       text not null default 'staff' check (role in ('staff','manager')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists staff_brand_idx on staff(brand_id);

-- Admin users = Supabase Auth users. Platform admins (the agency) see every brand.
create table if not exists profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  full_name         text,
  is_platform_admin boolean not null default false,
  created_at        timestamptz not null default now()
);

create table if not exists brand_members (
  user_id   uuid not null references profiles(id) on delete cascade,
  brand_id  uuid not null references brands(id) on delete cascade,
  role      text not null default 'owner' check (role in ('owner','manager','viewer')),
  primary key (user_id, brand_id)
);

-- Auto-create a profile row whenever an auth user is created
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id                 uuid primary key default gen_random_uuid(),
  brand_id           uuid not null references brands(id) on delete cascade,
  phone              text not null,                          -- E.164, e.g. +6591234567
  name               text not null,
  email              text,
  birthday           date,
  kind               text not null default 'customer' check (kind in ('customer','influencer')),
  marketing_consent  boolean not null default false,
  consent_at         timestamptz,
  stamp_balance      int not null default 0,                 -- stamps on the current card
  lifetime_stamps    int not null default 0,
  visits             int not null default 0,
  last_visit_at      timestamptz,
  referral_code      text not null unique default upper(substr(encode(gen_random_bytes(6),'hex'),1,8)),
  referred_by        uuid references customers(id) on delete set null,
  referral_rewarded  boolean not null default false,
  push_subscription  jsonb,                                  -- Web Push subscription JSON
  push_enabled_at    timestamptz,
  telegram_chat_id   bigint,
  whatsapp_opt_in    boolean not null default false,
  installed_at       timestamptz,                            -- added to home screen
  install_bonus_given boolean not null default false,
  migration_credited boolean not null default false,
  birthday_reward_year int,
  spin_available     boolean not null default false,        -- a spin is pending after the last stamp
  notes              text,
  created_at         timestamptz not null default now(),
  unique (brand_id, phone)
);
create index if not exists customers_brand_idx on customers(brand_id);
create index if not exists customers_last_visit_idx on customers(brand_id, last_visit_at);
create index if not exists customers_telegram_idx on customers(telegram_chat_id);

-- ---------------------------------------------------------------------------
-- Stamps (ledger) and rewards
-- ---------------------------------------------------------------------------
create table if not exists stamps (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  outlet_id   uuid references outlets(id) on delete set null,
  staff_id    uuid references staff(id) on delete set null,
  qty         int not null check (qty > 0),
  source      text not null check (source in ('staff','migration','spin','streak','referral','install','admin','campaign')),
  multiplier  int not null default 1,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists stamps_customer_idx on stamps(customer_id, created_at desc);
create index if not exists stamps_brand_created_idx on stamps(brand_id, created_at desc);

create table if not exists rewards (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references brands(id) on delete cascade,
  customer_id   uuid not null references customers(id) on delete cascade,
  code          text not null unique default upper(substr(encode(gen_random_bytes(5),'hex'),1,10)),
  type          text not null check (type in ('stamp_card','influencer','birthday','manual')),
  title         text not null,
  status        text not null default 'available' check (status in ('available','locked','redeemed','expired','void')),
  unlock_condition text,                                     -- e.g. 'ugc_verified'
  grant_id      uuid,                                        -- influencer grant this came from
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz,
  redeemed_at   timestamptz,
  redeemed_outlet_id uuid references outlets(id) on delete set null,
  redeemed_staff_id  uuid references staff(id) on delete set null
);
create index if not exists rewards_customer_idx on rewards(customer_id, status);
create index if not exists rewards_brand_status_idx on rewards(brand_id, status, expires_at);

-- ---------------------------------------------------------------------------
-- Influencer seeding
-- ---------------------------------------------------------------------------
create table if not exists influencer_grants (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references brands(id) on delete cascade,
  customer_id      uuid references customers(id) on delete set null,     -- set when claimed
  invite_code      text not null unique default upper(substr(encode(gen_random_bytes(5),'hex'),1,8)),
  handle           text not null,                                        -- @handle
  platform         text not null default 'instagram' check (platform in ('instagram','tiktok','lemon8','xiaohongshu','youtube','other')),
  followers        int,
  rewards_total    int not null default 4,
  rewards_upfront  int not null default 1,                               -- unlocked on accept; the rest unlock on verification
  reward_title     text not null default 'Free bowl (creator)',
  content_due_date date,
  deliverable      text not null default '1 Reel or TikTok + 1 Story, tagged, disclosed as gifted',
  agreement_text   text,
  status           text not null default 'invited' check (status in ('invited','accepted','posted','verified','expired','cancelled')),
  accepted_at      timestamptz,
  post_url         text,
  posted_at        timestamptz,
  verified_at      timestamptz,
  reach_notes      text,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists grants_brand_idx on influencer_grants(brand_id, status);

-- ---------------------------------------------------------------------------
-- Nudges: campaigns + notification log + double-stamp windows
-- ---------------------------------------------------------------------------
create table if not exists campaigns (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id) on delete cascade,
  title        text not null,
  body         text not null,
  url_path     text,                                       -- deep link within the card, e.g. /rewards
  segment      text not null default 'all' check (segment in ('all','near_reward','lapsed_14','lapsed_30','influencers','push_only','telegram_only')),
  bonus_stamps int not null default 0,                     -- optionally attach a bonus stamp to the send
  status       text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  scheduled_at timestamptz,
  sent_at      timestamptz,
  audience     int not null default 0,
  delivered    int not null default 0,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  trigger     text not null,                                 -- near_reward | lapsed | expiring | birthday | double_stamp | campaign | influencer_unlock | welcome
  channel     text not null check (channel in ('push','telegram','whatsapp')),
  title       text,
  body        text,
  status      text not null default 'sent' check (status in ('sent','failed','skipped')),
  error       text,
  sent_at     timestamptz not null default now()
);
create index if not exists notifications_customer_idx on notifications(customer_id, trigger, sent_at desc);

create table if not exists double_stamp_windows (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references brands(id) on delete cascade,
  outlet_id  uuid references outlets(id) on delete cascade,  -- null = all outlets
  title      text not null default 'Double stamp hours',
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  multiplier int not null default 2,
  announced  boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists dsw_brand_idx on double_stamp_windows(brand_id, starts_at);

-- Light analytics event log
create table if not exists events (
  id          bigserial primary key,
  brand_id    uuid not null references brands(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  type        text not null,                                 -- card_view | spin | install | push_opt_in | ...
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists events_brand_idx on events(brand_id, type, created_at desc);

-- ---------------------------------------------------------------------------
-- Core loyalty logic (atomic)
-- ---------------------------------------------------------------------------

-- Adds stamps to a customer, mints a reward every time the card fills, keeps counters in sync.
create or replace function add_stamps(
  p_customer_id uuid,
  p_qty         int,
  p_source      text,
  p_outlet_id   uuid default null,
  p_staff_id    uuid default null,
  p_multiplier  int default 1,
  p_note        text default null,
  p_counts_as_visit boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c         customers%rowtype;
  b         brands%rowtype;
  v_qty     int := greatest(p_qty, 0) * greatest(p_multiplier, 1);
  v_balance int;
  v_minted  int := 0;
  v_reward_ids uuid[] := '{}';
  v_id      uuid;
begin
  select * into c from customers where id = p_customer_id for update;
  if not found then raise exception 'customer not found'; end if;
  select * into b from brands where id = c.brand_id;
  if v_qty <= 0 then
    return jsonb_build_object('balance', c.stamp_balance, 'minted', 0, 'reward_ids', '[]'::jsonb);
  end if;

  insert into stamps (brand_id, customer_id, outlet_id, staff_id, qty, source, multiplier, note)
  values (c.brand_id, c.id, p_outlet_id, p_staff_id, v_qty, p_source, greatest(p_multiplier,1), p_note);

  v_balance := c.stamp_balance + v_qty;
  while v_balance >= b.stamps_per_reward loop
    v_balance := v_balance - b.stamps_per_reward;
    insert into rewards (brand_id, customer_id, type, title, expires_at)
    values (c.brand_id, c.id, 'stamp_card', b.reward_name, now() + make_interval(days => b.reward_valid_days))
    returning id into v_id;
    v_minted := v_minted + 1;
    v_reward_ids := v_reward_ids || v_id;
  end loop;

  update customers set
    stamp_balance   = v_balance,
    lifetime_stamps = lifetime_stamps + v_qty,
    visits          = visits + (case when p_counts_as_visit then 1 else 0 end),
    last_visit_at   = (case when p_counts_as_visit then now() else last_visit_at end),
    spin_available  = (case when p_source = 'staff' and b.spin_enabled then true else spin_available end)
  where id = c.id;

  return jsonb_build_object(
    'balance', v_balance,
    'added', v_qty,
    'minted', v_minted,
    'reward_ids', to_jsonb(v_reward_ids),
    'lifetime', c.lifetime_stamps + v_qty
  );
end $$;

-- Redeems a reward by code. Single-use, must be available and not expired.
create or replace function redeem_reward(
  p_code      text,
  p_outlet_id uuid default null,
  p_staff_id  uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r rewards%rowtype;
begin
  select * into r from rewards where code = upper(p_code) for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Reward not found'); end if;
  if r.status = 'redeemed' then return jsonb_build_object('ok', false, 'error', 'Already redeemed'); end if;
  if r.status = 'locked' then return jsonb_build_object('ok', false, 'error', 'Reward is still locked'); end if;
  if r.status <> 'available' then return jsonb_build_object('ok', false, 'error', 'Reward is ' || r.status); end if;
  if r.expires_at is not null and r.expires_at < now() then
    update rewards set status = 'expired' where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'Reward expired');
  end if;
  update rewards set status = 'redeemed', redeemed_at = now(),
    redeemed_outlet_id = p_outlet_id, redeemed_staff_id = p_staff_id
  where id = r.id;
  update customers set visits = visits + 1, last_visit_at = now() where id = r.customer_id;
  return jsonb_build_object('ok', true, 'reward_id', r.id, 'customer_id', r.customer_id, 'title', r.title);
end $$;

-- Dashboard numbers for one brand, in one round trip
create or replace function brand_stats(p_brand_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with
  cust as (select * from customers where brand_id = p_brand_id),
  st   as (select * from stamps where brand_id = p_brand_id),
  rw   as (select * from rewards where brand_id = p_brand_id)
  select jsonb_build_object(
    'customers',        (select count(*) from cust),
    'signups_7d',       (select count(*) from cust where created_at > now() - interval '7 days'),
    'signups_30d',      (select count(*) from cust where created_at > now() - interval '30 days'),
    'active_30d',       (select count(*) from cust where last_visit_at > now() - interval '30 days'),
    'returning_30d',    (select count(*) from cust where visits >= 2 and last_visit_at > now() - interval '30 days'),
    'stamps_today',     (select coalesce(sum(qty),0) from st where created_at > date_trunc('day', now() at time zone 'Asia/Singapore') at time zone 'Asia/Singapore'),
    'stamps_7d',        (select coalesce(sum(qty),0) from st where created_at > now() - interval '7 days'),
    'stamps_30d',       (select coalesce(sum(qty),0) from st where created_at > now() - interval '30 days'),
    'rewards_issued',   (select count(*) from rw where type = 'stamp_card'),
    'rewards_redeemed', (select count(*) from rw where status = 'redeemed'),
    'rewards_open',     (select count(*) from rw where status = 'available'),
    'push_opt_in',      (select count(*) from cust where push_subscription is not null),
    'telegram_linked',  (select count(*) from cust where telegram_chat_id is not null),
    'installed',        (select count(*) from cust where installed_at is not null),
    'influencers',      (select count(*) from cust where kind = 'influencer'),
    'near_reward',      (select count(*) from cust c join brands b on b.id = c.brand_id where c.stamp_balance >= b.stamps_per_reward - 2),
    'lapsed_14',        (select count(*) from cust where last_visit_at < now() - interval '14 days'),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'stamps', coalesce(s.qty,0), 'signups', coalesce(c.n,0)) order by d), '[]'::jsonb)
      from generate_series((now() at time zone 'Asia/Singapore')::date - 29, (now() at time zone 'Asia/Singapore')::date, '1 day') d
      left join (select (created_at at time zone 'Asia/Singapore')::date dd, sum(qty) qty from st group by 1) s on s.dd = d::date
      left join (select (created_at at time zone 'Asia/Singapore')::date dd, count(*) n from cust group by 1) c on c.dd = d::date
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: lock everything down. The app only talks to the DB with the service role.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array['brands','outlets','staff','profiles','brand_members','customers','stamps','rewards',
                               'influencer_grants','campaigns','notifications','double_stamp_windows','events'])
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Admin users may read their own profile and memberships (used by the admin login flow)
drop policy if exists "profiles self read" on profiles;
create policy "profiles self read" on profiles for select to authenticated using (id = auth.uid());
drop policy if exists "members self read" on brand_members;
create policy "members self read" on brand_members for select to authenticated using (user_id = auth.uid());
