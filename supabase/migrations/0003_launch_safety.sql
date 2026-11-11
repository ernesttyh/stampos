-- Launch safety: all benefit eligibility and resulting credits share one transaction.
-- Run after 0001 and 0002. Existing reward/stamp history is never rewritten.

-- Stop before changing anything if historical tenant links need human review.
do $$
declare details text;
begin
  select string_agg(id::text,', ') into details from (
    select r.id from rewards r left join customers c on c.id=r.customer_id
      left join influencer_grants g on g.id=r.grant_id
    where c.id is null or r.brand_id is distinct from c.brand_id
      or (r.grant_id is not null and (g.id is null or g.brand_id is distinct from r.brand_id or g.customer_id is distinct from r.customer_id))
    order by r.id limit 10
  ) mismatches;
  if details is not null then
    raise exception 'Launch safety aborted: reward tenant/customer/grant mismatch. Example reward IDs: %',details
      using hint='Review rewards joined to customers and influencer_grants by customer_id/grant_id. Reconcile with the owner; this migration never rewrites history.';
  end if;
  select string_agg(id::text,', ') into details from (
    select g.id from influencer_grants g join customers c on c.id=g.customer_id
      where g.brand_id is distinct from c.brand_id order by g.id limit 10
  ) mismatches;
  if details is not null then
    raise exception 'Launch safety aborted: grant/customer tenant mismatch. Example grant IDs: %',details
      using hint='Review influencer_grants joined to customers by customer_id. Resolve historical ownership before retrying.';
  end if;
end $$;

create table if not exists public.creator_benefits (
  brand_id uuid not null references public.brands(id) on delete cascade,
  phone text not null,
  benefit_key text not null default 'creator_four_bowls_v1',
  customer_id uuid not null references public.customers(id),
  grant_id uuid not null references public.influencer_grants(id),
  request_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (brand_id, phone, benefit_key),
  unique (brand_id, request_id),
  unique (grant_id)
);
alter table public.creator_benefits enable row level security;

create table if not exists public.manual_adjustments (
  brand_id uuid not null references public.brands(id) on delete cascade,
  request_id uuid not null,
  customer_id uuid not null references public.customers(id),
  actor_id uuid not null references public.profiles(id),
  parameters jsonb not null,
  result jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (brand_id,request_id)
);
alter table public.manual_adjustments enable row level security;

-- Defense in depth: callers still authenticate sessions; RPCs validate current DB scope.
create or replace function public.assert_staff_scope(p_staff_id uuid, p_brand_id uuid, p_outlet_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s staff%rowtype;
begin
  select * into s from staff where id = p_staff_id for share;
  if not found or not s.active or s.brand_id <> p_brand_id
     or p_outlet_id is null or (s.outlet_id is not null and s.outlet_id <> p_outlet_id) then
    raise exception 'Staff access denied' using errcode = '42501';
  end if;
  perform 1 from outlets where id = p_outlet_id and brand_id = p_brand_id and active for share;
  if not found then raise exception 'Outlet access denied' using errcode = '42501'; end if;
end $$;

create or replace function public.assert_brand_actor(p_actor_id uuid, p_brand_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from profiles where id = p_actor_id and is_platform_admin for share;
  if found then return; end if;
  perform 1 from brand_members where user_id = p_actor_id and brand_id = p_brand_id
    and role in ('owner', 'manager') for share;
  if not found then raise exception 'Brand write access denied' using errcode = '42501'; end if;
end $$;

-- Replace the primitive too: invalid reward thresholds must never cause an infinite loop.
create or replace function public.add_stamps(
  p_customer_id uuid, p_qty int, p_source text, p_outlet_id uuid default null,
  p_staff_id uuid default null, p_multiplier int default 1, p_note text default null,
  p_counts_as_visit boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c customers%rowtype; b brands%rowtype;
  v_qty int := greatest(p_qty, 0) * greatest(p_multiplier, 1);
  v_balance int; v_minted int := 0; v_reward_ids uuid[] := '{}'; v_id uuid;
begin
  select * into c from customers where id = p_customer_id for update;
  if not found then raise exception 'Customer not found'; end if;
  select * into b from brands where id = c.brand_id;
  if b.stamps_per_reward < 1 then raise exception 'Invalid stamps per reward'; end if;
  if p_outlet_id is not null and not exists (select 1 from outlets where id = p_outlet_id and brand_id = c.brand_id) then
    raise exception 'Outlet brand mismatch';
  end if;
  if p_staff_id is not null then perform assert_staff_scope(p_staff_id, c.brand_id, p_outlet_id); end if;
  if v_qty <= 0 then
    return jsonb_build_object('balance',c.stamp_balance,'added',0,'minted',0,'reward_ids','[]'::jsonb,'lifetime',c.lifetime_stamps);
  end if;
  insert into stamps(brand_id,customer_id,outlet_id,staff_id,qty,source,multiplier,note)
    values(c.brand_id,c.id,p_outlet_id,p_staff_id,v_qty,p_source,greatest(p_multiplier,1),p_note);
  v_balance := c.stamp_balance + v_qty;
  while v_balance >= b.stamps_per_reward loop
    v_balance := v_balance - b.stamps_per_reward;
    insert into rewards(brand_id,customer_id,type,title,expires_at)
      values(c.brand_id,c.id,'stamp_card',b.reward_name,now()+make_interval(days=>b.reward_valid_days)) returning id into v_id;
    v_minted := v_minted + 1;
    v_reward_ids := v_reward_ids || v_id;
  end loop;
  update customers set stamp_balance=v_balance,lifetime_stamps=lifetime_stamps+v_qty,
    visits=visits+case when p_counts_as_visit then 1 else 0 end,
    last_visit_at=case when p_counts_as_visit then now() else last_visit_at end,
    spin_available=case when p_source='staff' and b.spin_enabled then true else spin_available end
    where id=c.id;
  return jsonb_build_object('balance',v_balance,'added',v_qty,'minted',v_minted,
    'reward_ids',to_jsonb(v_reward_ids),'lifetime',c.lifetime_stamps+v_qty);
end $$;

create or replace function public.staff_issue_stamps(
  p_customer_id uuid, p_qty int, p_outlet_id uuid, p_staff_id uuid, p_mode text default 'staff'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c customers%rowtype; b brands%rowtype; w double_stamp_windows%rowtype;
  r jsonb; x jsonb; ref_result jsonb; bonuses jsonb := '[]';
  v_qty int; v_multiplier int := 1; v_minted int; v_ref uuid;
begin
  if p_qty is null or p_qty < 1 or p_mode not in ('staff','migration') or p_mode is null then
    raise exception 'Invalid stamp request';
  end if;
  select * into c from customers where id=p_customer_id;
  if not found then raise exception 'Customer not found'; end if;
  perform assert_staff_scope(p_staff_id,c.brand_id,p_outlet_id);
  -- Referral pairs lock in UUID order, avoiding reciprocal-referral deadlocks.
  perform id from customers where id=c.id or (id=c.referred_by and brand_id=c.brand_id) order by id for update;
  select * into c from customers where id=p_customer_id;
  select * into b from brands where id=c.brand_id;
  if p_mode='migration' then
    if c.migration_credited then raise exception 'Old card already credited for this customer'; end if;
    if b.migration_until is not null and b.migration_until < (now() at time zone b.timezone)::date then
      raise exception 'Old-card migration window has closed';
    end if;
    if b.migration_cap < 1 then raise exception 'Invalid migration cap'; end if;
    v_qty := least(p_qty,b.migration_cap);
    update customers set migration_credited=true where id=c.id;
    r := add_stamps(c.id,v_qty,'migration',p_outlet_id,p_staff_id,1,'Physical card credit',false);
    return r || jsonb_build_object('multiplier',1,'bonuses','[]'::jsonb);
  end if;
  if exists(select 1 from stamps where customer_id=c.id and source='staff' and created_at > now()-interval '20 seconds') then
    raise exception 'Just stamped — wait a moment before stamping again' using errcode='P0001';
  end if;
  if b.max_stamps_per_visit < 1 then raise exception 'Invalid visit cap'; end if;
  v_qty := least(p_qty,b.max_stamps_per_visit);
  select * into w from double_stamp_windows where brand_id=b.id and starts_at<=now() and ends_at>=now()
    and (outlet_id is null or outlet_id=p_outlet_id) order by multiplier desc limit 1;
  v_multiplier := greatest(coalesce(w.multiplier,1),1);
  r := add_stamps(c.id,v_qty,'staff',p_outlet_id,p_staff_id,v_multiplier,w.title,true);
  v_minted := (r->>'minted')::int;
  if b.streak_enabled and c.last_visit_at between now()-interval '14 days' and now()-interval '4 days'
    and not exists(select 1 from stamps where customer_id=c.id and source='streak' and created_at>=now()-interval '5 days') then
    x := add_stamps(c.id,1,'streak',p_outlet_id,p_staff_id,1,'Back within 2 weeks',false);
    v_minted := v_minted+(x->>'minted')::int;
    bonuses := bonuses || jsonb_build_array(jsonb_build_object('source','streak','qty',1,'label','Streak bonus — back within 2 weeks'));
  end if;
  if b.referral_enabled and c.referred_by is not null and not c.referral_rewarded and c.referred_by<>c.id then
    select id into v_ref from customers where id=c.referred_by and brand_id=c.brand_id;
    if v_ref is not null then
      update customers set referral_rewarded=true where id=c.id;
      x := add_stamps(c.id,1,'referral',p_outlet_id,p_staff_id,1,'Welcome via friend',false);
      v_minted := v_minted+(x->>'minted')::int;
      ref_result := add_stamps(v_ref,1,'referral',null,null,1,'Friend referral',false);
      bonuses := bonuses || jsonb_build_array(jsonb_build_object('source','referral','qty',1,'label','Friend bonus'));
    end if;
  end if;
  select * into c from customers where id=p_customer_id;
  return r || jsonb_build_object('balance',c.stamp_balance,'lifetime',c.lifetime_stamps,
    'minted',v_minted,'multiplier',v_multiplier,'bonuses',bonuses,'referrer_id',v_ref,'referrer_result',ref_result);
end $$;

create or replace function public.claim_customer_bonus(p_customer_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c customers%rowtype; b brands%rowtype; r jsonb; v_won boolean; v_roll int; v_odds int;
begin
  select * into c from customers where id=p_customer_id for update;
  if not found then raise exception 'Customer not found'; end if;
  select * into b from brands where id=c.brand_id;
  if p_kind='install' then
    update customers set installed_at=coalesce(installed_at,now()) where id=c.id;
    if not b.install_bonus_enabled or c.install_bonus_given then return jsonb_build_object('given',false); end if;
    update customers set install_bonus_given=true where id=c.id;
    r := add_stamps(c.id,1,'install',null,null,1,'Saved to home screen',false);
    insert into events(brand_id,customer_id,type) values(b.id,c.id,'install');
    return r || jsonb_build_object('given',true);
  elsif p_kind='spin' then
    if not b.spin_enabled or not c.spin_available then return jsonb_build_object('ok',false,'error','No spin available'); end if;
    update customers set spin_available=false where id=c.id;
    v_odds := greatest(2,b.spin_double_odds);
    v_roll := floor(random()*v_odds)::int;
    v_won := v_roll=0;
    r := jsonb_build_object('balance',c.stamp_balance,'minted',0);
    if v_won then r := add_stamps(c.id,1,'spin',null,null,1,'Lucky spin',false); end if;
    insert into events(brand_id,customer_id,type,meta) values(b.id,c.id,'spin',jsonb_build_object('won',v_won,'roll',v_roll,'odds',v_odds));
    return r || jsonb_build_object('ok',true,'won',v_won,'wedge',case when v_won then 0 else 1+floor(random()*7)::int end);
  end if;
  raise exception 'Unknown bonus kind';
end $$;

create or replace function public.accept_creator_grant(p_grant_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g influencer_grants%rowtype; c customers%rowtype; v_upfront int; v_expires timestamptz;
begin
  select * into g from influencer_grants where id=p_grant_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Invite not found'); end if;
  if g.status<>'invited' then return jsonb_build_object('ok',false,'error','This invite has already been used'); end if;
  select * into c from customers where id=p_customer_id and brand_id=g.brand_id for update;
  if not found then raise exception 'Customer brand mismatch'; end if;
  if g.rewards_total<0 or g.rewards_upfront<0 or g.rewards_total>100 then raise exception 'Invalid grant allocation'; end if;
  v_upfront := least(g.rewards_upfront,g.rewards_total);
  v_expires := coalesce(g.content_due_date::timestamptz+interval '45 days',now()+interval '90 days');
  -- Link before inserting rewards so relationship guards can verify the complete tuple.
  update influencer_grants set status='accepted',accepted_at=now(),customer_id=c.id where id=g.id;
  insert into rewards(brand_id,customer_id,type,title,status,grant_id,expires_at,unlock_condition)
    select g.brand_id,c.id,'influencer',g.reward_title,case when i<=v_upfront then 'available' else 'locked' end,
      g.id,v_expires,case when i<=v_upfront then null else 'ugc_verified' end
    from generate_series(1,g.rewards_total) i;
  update customers set kind='influencer' where id=c.id;
  insert into events(brand_id,customer_id,type,meta) values(g.brand_id,c.id,'creator_invite_accepted',jsonb_build_object('grant_id',g.id));
  return jsonb_build_object('ok',true,'upfront',v_upfront,'locked',g.rewards_total-v_upfront);
end $$;

create or replace function public.manage_creator_grant(
  p_grant_id uuid,p_brand_id uuid,p_actor_id uuid,p_action text,p_post_url text default null,p_reach_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare g influencer_grants%rowtype; v_count int := 0;
begin
  perform assert_brand_actor(p_actor_id,p_brand_id);
  select * into g from influencer_grants where id=p_grant_id and brand_id=p_brand_id for update;
  if not found then raise exception 'Grant not found'; end if;
  if p_action='verify' then
    if g.status='verified' then return jsonb_build_object('ok',true,'unlocked',0,'customer_id',g.customer_id,'already_processed',true); end if;
    if g.status not in ('accepted','posted') then raise exception 'Grant cannot be verified in its current state'; end if;
    update rewards set status='available',unlock_condition=null where grant_id=g.id and brand_id=p_brand_id
      and status='locked' and (expires_at is null or expires_at>now());
    get diagnostics v_count = row_count;
    update influencer_grants set status='verified',verified_at=now(),post_url=coalesce(p_post_url,post_url),
      posted_at=coalesce(posted_at,now()),reach_notes=coalesce(p_reach_notes,reach_notes) where id=g.id;
  elsif p_action='cancel' then
    if g.status='cancelled' then return jsonb_build_object('ok',true,'unlocked',0,'customer_id',g.customer_id,'already_processed',true); end if;
    update rewards set status='void',unlock_condition=null where grant_id=g.id and brand_id=p_brand_id and status in ('available','locked');
    update influencer_grants set status='cancelled' where id=g.id;
  else raise exception 'Unknown grant action'; end if;
  insert into events(brand_id,customer_id,type,meta) values(p_brand_id,g.customer_id,'creator_grant_'||p_action,
    jsonb_build_object('grant_id',g.id,'actor_id',p_actor_id,'unlocked',v_count));
  return jsonb_build_object('ok',true,'unlocked',v_count,'customer_id',g.customer_id);
end $$;

create or replace function public.admin_credit_creator(
  p_brand_id uuid,p_phone text,p_name text,p_handle text,p_platform text,p_actor_id uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c customers%rowtype; b brands%rowtype; benefit creator_benefits%rowtype; v_grant_id uuid;
begin
  perform assert_brand_actor(p_actor_id,p_brand_id);
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' or length(trim(coalesce(p_name,'')))<2
    or length(trim(coalesce(p_handle,'')))<1 or p_request_id is null
    or p_platform is null or p_platform not in ('instagram','tiktok','lemon8','xiaohongshu','youtube','other') then
    raise exception 'Invalid creator details';
  end if;
  select * into b from brands where id=p_brand_id;
  if not found then raise exception 'Brand not found'; end if;
  if b.slug<>'chengdu-bowl' then raise exception 'Four-bowl creator launch offer is only available for Chengdu Bowl'; end if;
  if b.reward_valid_days<1 then raise exception 'Brand reward validity must be at least one day'; end if;
  -- Upsert acquires the same customer lock for all requests for this brand+phone.
  -- Never replace existing identity, birthday, marketing consent or opt-ins.
  insert into customers(brand_id,phone,name,kind,marketing_consent)
    values(p_brand_id,p_phone,left(trim(p_name),60),'influencer',false)
    on conflict(brand_id,phone) do update set kind='influencer' returning * into c;
  select * into benefit from creator_benefits where brand_id=p_brand_id and request_id=p_request_id;
  if found and benefit.phone<>p_phone then raise exception 'Request ID already used for another customer'; end if;
  select * into benefit from creator_benefits where brand_id=p_brand_id and phone=p_phone and benefit_key='creator_four_bowls_v1';
  if found then
    return jsonb_build_object('customer_id',benefit.customer_id,'grant_id',benefit.grant_id,'already_credited',true);
  end if;
  if exists(select 1 from influencer_grants where brand_id=p_brand_id and customer_id=c.id)
    or exists(select 1 from rewards where brand_id=p_brand_id and customer_id=c.id and type='influencer') then
    raise exception 'Creator has existing grant or reward history. Review the existing rewards/history before allocating this launch offer; manual review is required, including cancelled or expired grants.';
  end if;
  insert into influencer_grants(brand_id,customer_id,handle,platform,rewards_total,rewards_upfront,reward_title,
    status,accepted_at,created_by,deliverable)
    values(p_brand_id,c.id,trim(p_handle),p_platform,4,4,'Complimentary bowl (creator)',
      'accepted',now(),p_actor_id,'Complimentary creator allocation — no content lock') returning id into v_grant_id;
  insert into creator_benefits(brand_id,phone,customer_id,grant_id,request_id,actor_id)
    values(p_brand_id,p_phone,c.id,v_grant_id,p_request_id,p_actor_id);
  insert into rewards(brand_id,customer_id,type,title,status,grant_id,expires_at)
    select p_brand_id,c.id,'influencer','Complimentary bowl (creator)','available',v_grant_id,
      now()+make_interval(days=>b.reward_valid_days) from generate_series(1,4);
  insert into events(brand_id,customer_id,type,meta) values(p_brand_id,c.id,'creator_four_bowls_credited',
    jsonb_build_object('grant_id',v_grant_id,'actor_id',p_actor_id,'request_id',p_request_id,'quantity',4,'benefit_key','creator_four_bowls_v1'));
  return jsonb_build_object('customer_id',c.id,'grant_id',v_grant_id,'already_credited',false);
end $$;

create or replace function public.admin_adjust_customer(
  p_brand_id uuid,p_customer_id uuid,p_actor_id uuid,p_request_id uuid,
  p_kind text,p_qty int,p_title text,p_days int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c customers%rowtype; a manual_adjustments%rowtype; v_params jsonb; r jsonb; v_ids uuid[]; v_id uuid; i int;
begin
  perform assert_brand_actor(p_actor_id,p_brand_id);
  if p_request_id is null or p_kind is null or p_kind not in ('stamps','reward')
    or p_qty is null or p_qty<1 or p_qty>100
    or (p_kind='reward' and (length(trim(coalesce(p_title,'')))<1 or p_days is null or p_days<1 or p_days>3650)) then
    raise exception 'Invalid manual adjustment';
  end if;
  select * into c from customers where id=p_customer_id and brand_id=p_brand_id for update;
  if not found then raise exception 'Customer not found for this brand'; end if;
  v_params := jsonb_build_object('customer_id',p_customer_id,'kind',p_kind,'qty',p_qty,'title',p_title,'days',p_days);
  select * into a from manual_adjustments where brand_id=p_brand_id and request_id=p_request_id;
  if found then
    if a.parameters<>v_params then raise exception 'Request ID reused with different adjustment'; end if;
    return a.result || jsonb_build_object('already_processed',true);
  end if;
  -- Unique request insert occurs before credit. A conflicting concurrent request for
  -- another customer aborts without committing any benefit.
  insert into manual_adjustments(brand_id,request_id,customer_id,actor_id,parameters)
    values(p_brand_id,p_request_id,c.id,p_actor_id,v_params);
  if p_kind='stamps' then
    r := add_stamps(c.id,p_qty,'admin',null,null,1,coalesce(nullif(trim(p_title),''),'Manual adjustment'),false);
  else
    v_ids := '{}';
    for i in 1..p_qty loop
      insert into rewards(brand_id,customer_id,type,title,status,expires_at)
        values(p_brand_id,c.id,'manual',left(trim(p_title),200),'available',now()+make_interval(days=>p_days)) returning id into v_id;
      v_ids := v_ids || v_id;
    end loop;
    r := jsonb_build_object('reward_ids',to_jsonb(v_ids),'minted',p_qty);
  end if;
  r := r || jsonb_build_object('ok',true,'customer_id',c.id,'already_processed',false);
  update manual_adjustments set result=r where brand_id=p_brand_id and request_id=p_request_id;
  insert into events(brand_id,customer_id,type,meta) values(p_brand_id,c.id,'manual_'||p_kind||'_adjustment',
    v_params || jsonb_build_object('actor_id',p_actor_id,'request_id',p_request_id));
  return r;
end $$;

create or replace function public.redeem_reward(p_code text,p_outlet_id uuid default null,p_staff_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rewards%rowtype;
begin
  select * into r from rewards where code=upper(p_code);
  if not found then return jsonb_build_object('ok',false,'error','Reward not found'); end if;
  perform assert_staff_scope(p_staff_id,r.brand_id,p_outlet_id);
  -- Consistent customer-before-reward ordering with other loyalty operations.
  perform 1 from customers where id=r.customer_id and brand_id=r.brand_id for update;
  if not found then raise exception 'Customer brand mismatch'; end if;
  select * into r from rewards where code=upper(p_code) for update;
  if r.status<>'available' then return jsonb_build_object('ok',false,'error','Reward is '||r.status); end if;
  if r.expires_at is not null and r.expires_at<=now() then
    update rewards set status='expired' where id=r.id;
    return jsonb_build_object('ok',false,'error','Reward expired');
  end if;
  update rewards set status='redeemed',redeemed_at=now(),redeemed_outlet_id=p_outlet_id,redeemed_staff_id=p_staff_id where id=r.id;
  update customers set visits=visits+1,last_visit_at=now() where id=r.customer_id;
  return jsonb_build_object('ok',true,'reward_id',r.id,'customer_id',r.customer_id,'title',r.title);
end $$;

-- Relationship guards also protect privileged server writes outside these RPCs.
create or replace function public.guard_reward_relationships()
returns trigger language plpgsql security definer set search_path=public as $$
declare c customers%rowtype; g influencer_grants%rowtype;
begin
  select * into c from customers where id=new.customer_id for share;
  if not found or c.brand_id<>new.brand_id then raise exception 'Reward customer/brand mismatch'; end if;
  if new.grant_id is not null then
    select * into g from influencer_grants where id=new.grant_id for share;
    if not found or g.brand_id<>new.brand_id or g.customer_id is distinct from new.customer_id then
      raise exception 'Reward grant/brand/customer mismatch';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists reward_relationship_guard on public.rewards;
create trigger reward_relationship_guard before insert or update of brand_id,customer_id,grant_id on public.rewards
  for each row execute function public.guard_reward_relationships();

create or replace function public.guard_grant_relationships()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.customer_id is not null then
    perform 1 from customers where id=new.customer_id and brand_id=new.brand_id for share;
    if not found then raise exception 'Grant customer/brand mismatch'; end if;
  end if;
  if exists(select 1 from rewards where grant_id=new.id and
    (brand_id is distinct from new.brand_id or customer_id is distinct from new.customer_id)) then
    raise exception 'Grant change would invalidate historical reward ownership';
  end if;
  return new;
end $$;
drop trigger if exists grant_relationship_guard on public.influencer_grants;
create trigger grant_relationship_guard before insert or update of brand_id,customer_id on public.influencer_grants
  for each row execute function public.guard_grant_relationships();

create or replace function public.guard_customer_brand_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.brand_id is distinct from old.brand_id and (
    exists(select 1 from rewards where customer_id=new.id and brand_id<>new.brand_id)
    or exists(select 1 from influencer_grants where customer_id=new.id and brand_id<>new.brand_id)
    or exists(select 1 from stamps where customer_id=new.id and brand_id<>new.brand_id)
  ) then raise exception 'Customer brand change would invalidate loyalty history'; end if;
  return new;
end $$;
drop trigger if exists customer_brand_change_guard on public.customers;
create trigger customer_brand_change_guard before update of brand_id on public.customers
  for each row execute function public.guard_customer_brand_change();

-- grant_id historically had no FK. Preflight above reports any orphan before adding it.
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.rewards'::regclass and conname='rewards_grant_id_fkey') then
    alter table public.rewards add constraint rewards_grant_id_fkey foreign key(grant_id) references public.influencer_grants(id);
  end if;
end $$;

-- No authenticated/anonymous direct RPC access, including helper functions.
revoke all on public.creator_benefits from public,anon,authenticated;
grant all on public.creator_benefits to service_role;
revoke all on public.manual_adjustments from public,anon,authenticated;
grant all on public.manual_adjustments to service_role;
revoke execute on function public.assert_staff_scope(uuid,uuid,uuid) from public,anon,authenticated;
revoke execute on function public.assert_brand_actor(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.guard_reward_relationships() from public,anon,authenticated;
revoke execute on function public.guard_grant_relationships() from public,anon,authenticated;
revoke execute on function public.guard_customer_brand_change() from public,anon,authenticated;
revoke execute on function public.staff_issue_stamps(uuid,int,uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.claim_customer_bonus(uuid,text) from public,anon,authenticated;
revoke execute on function public.accept_creator_grant(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.manage_creator_grant(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke execute on function public.admin_credit_creator(uuid,text,text,text,text,uuid,uuid) from public,anon,authenticated;
revoke execute on function public.admin_adjust_customer(uuid,uuid,uuid,uuid,text,int,text,int) from public,anon,authenticated;
revoke execute on function public.add_stamps(uuid,int,text,uuid,uuid,int,text,boolean) from public,anon,authenticated;
revoke execute on function public.redeem_reward(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_staff_scope(uuid,uuid,uuid) to service_role;
grant execute on function public.assert_brand_actor(uuid,uuid) to service_role;
grant execute on function public.staff_issue_stamps(uuid,int,uuid,uuid,text) to service_role;
grant execute on function public.claim_customer_bonus(uuid,text) to service_role;
grant execute on function public.accept_creator_grant(uuid,uuid) to service_role;
grant execute on function public.manage_creator_grant(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.admin_credit_creator(uuid,text,text,text,text,uuid,uuid) to service_role;
grant execute on function public.admin_adjust_customer(uuid,uuid,uuid,uuid,text,int,text,int) to service_role;
grant execute on function public.add_stamps(uuid,int,text,uuid,uuid,int,text,boolean) to service_role;
grant execute on function public.redeem_reward(text,uuid,uuid) to service_role;
