-- Run after database_bootstrap.sql in an isolated LOCAL PostgreSQL database.
\set ON_ERROR_STOP on
begin;
create function pg_temp.must_fail(p_sql text) returns void language plpgsql as $$
declare failed boolean := false;
begin
  begin execute p_sql; exception when others then failed:=true; end;
  if not failed then raise exception 'Expected failure: %',p_sql; end if;
end $$;
create function pg_temp.reject_test_event() returns trigger language plpgsql as $$
begin
  if current_setting('stampos.test_fail_events',true)='on' and new.type in ('spin','install') then
    raise exception 'Injected audit event failure';
  end if;
  return new;
end $$;
create trigger database_test_event_failure before insert on events for each row execute function pg_temp.reject_test_event();
do $$
declare
  b uuid; other_b uuid; outlet uuid; other_outlet uuid; worker uuid; actor uuid:=gen_random_uuid();
  viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); platform_actor uuid:=gen_random_uuid();
  customer uuid; referrer uuid; other_customer uuid; g uuid; result jsonb; again jsonb; req uuid:=gen_random_uuid();
  manual_req uuid:=gen_random_uuid(); reward_code text; before_count int;
begin
  insert into brands(slug,name,migration_until) values('chengdu-bowl','Database test',current_date+7) returning id into b;
  insert into brands(slug,name) values('db-other-'||gen_random_uuid(),'Other brand') returning id into other_b;
  insert into outlets(brand_id,name) values(b,'Test outlet') returning id into outlet;
  insert into outlets(brand_id,name) values(other_b,'Other outlet') returning id into other_outlet;
  insert into staff(brand_id,outlet_id,name,pin_hash) values(b,outlet,'Worker','unused') returning id into worker;
  insert into auth.users(id,email) values(actor,'owner@test.invalid'),(viewer,'viewer@test.invalid'),
    (outsider,'outsider@test.invalid'),(platform_actor,'platform@test.invalid');
  insert into brand_members(user_id,brand_id,role) values(actor,b,'owner'),(viewer,b,'viewer');
  update profiles set is_platform_admin=true where id=platform_actor;
  insert into customers(brand_id,phone,name) values(b,'+6590000001','Friend') returning id into referrer;
  insert into customers(brand_id,phone,name,referred_by,last_visit_at) values(b,'+6590000002','Original Name',referrer,now()-interval '7 days') returning id into customer;
  insert into customers(brand_id,phone,name) values(other_b,'+6590000002','Other Name') returning id into other_customer;

  -- Exact four, immediately available, same-brand phone isolation, no implicit consent/name overwrite.
  result:=admin_credit_creator(b,'+6590000002','Do Not Replace','@creator','instagram',actor,req);
  assert not (result->>'already_credited')::boolean;
  g:=(result->>'grant_id')::uuid;
  assert (select count(*)=4 from rewards where grant_id=g and status='available' and unlock_condition is null);
  assert (select name='Original Name' and not marketing_consent and kind='influencer' from customers where id=customer);
  assert (select kind='customer' from customers where id=other_customer);
  again:=admin_credit_creator(b,'+6590000002','Another Name','@new','tiktok',actor,gen_random_uuid());
  assert (again->>'already_credited')::boolean and again->>'grant_id'=result->>'grant_id';
  assert (select count(*)=4 from rewards where grant_id=g);
  perform pg_temp.must_fail(format('select admin_credit_creator(%L,%L,%L,%L,%L,%L,%L)',b,'+6590000003','Viewer','@v','instagram',viewer,gen_random_uuid()));
  perform pg_temp.must_fail(format('select admin_credit_creator(%L,%L,%L,%L,%L,%L,%L)',b,'+6590000003','Other','@v','instagram',outsider,gen_random_uuid()));
  perform pg_temp.must_fail(format('select admin_credit_creator(%L,%L,%L,%L,%L,%L,%L)',b,'+6590000003','Other','@v','instagram',actor,req));
  assert not exists(select 1 from customers where brand_id=b and phone='+6590000003');
  perform pg_temp.must_fail(format('select admin_credit_creator(%L,%L,%L,%L,%L,%L,%L)',other_b,'+6590000002','Other Name','@other','instagram',platform_actor,gen_random_uuid()));
  result:=admin_adjust_customer(other_b,other_customer,platform_actor,gen_random_uuid(),'stamps',1,'Platform audit note',null);
  assert (result->>'ok')::boolean;
  assert (select note='Platform audit note' from stamps where customer_id=other_customer and source='admin');
  -- Any unkeyed legacy creator history requires manual review, even cancelled history.
  insert into influencer_grants(brand_id,customer_id,handle,status) values(b,referrer,'@legacy','cancelled');
  perform pg_temp.must_fail(format('select admin_credit_creator(%L,%L,%L,%L,%L,%L,%L)',b,'+6590000001','Friend','@legacy','instagram',actor,gen_random_uuid()));
  assert (select kind='customer' from customers where id=referrer);

  -- Atomic base + streak + referral; cooldown cannot be bypassed by reusing stale inputs.
  result:=staff_issue_stamps(customer,2,outlet,worker,'staff');
  assert (result->>'added')::int=2 and jsonb_array_length(result->'bonuses')=2;
  assert (select lifetime_stamps=4 and referral_rewarded from customers where id=customer);
  assert (select lifetime_stamps=1 from customers where id=referrer);
  perform pg_temp.must_fail(format('select staff_issue_stamps(%L,2,%L,%L)',customer,outlet,worker));
  perform pg_temp.must_fail(format('select staff_issue_stamps(%L,1,%L,%L)',other_customer,outlet,worker));
  perform pg_temp.must_fail(format('select staff_issue_stamps(%L,1,%L,%L)',customer,other_outlet,worker));
  update staff set active=false where id=worker;
  perform pg_temp.must_fail(format('select staff_issue_stamps(%L,1,%L,%L,%L)',customer,outlet,worker,'migration'));
  update staff set active=true where id=worker;
  result:=staff_issue_stamps(customer,9,outlet,worker,'migration');
  assert (result->>'added')::int=9;
  perform pg_temp.must_fail(format('select staff_issue_stamps(%L,9,%L,%L,%L)',customer,outlet,worker,'migration'));
  result:=claim_customer_bonus(customer,'install');
  assert (result->>'given')::boolean;
  result:=claim_customer_bonus(customer,'install');
  assert not (result->>'given')::boolean;
  result:=claim_customer_bonus(customer,'spin');
  assert (result->>'ok')::boolean;
  result:=claim_customer_bonus(customer,'spin');
  assert not (result->>'ok')::boolean;

  -- Failure injection: consumed flags and ledger updates roll back together.
  update brands set stamps_per_reward=0 where id=b;
  perform pg_temp.must_fail(format('select staff_issue_stamps(%L,9,%L,%L,%L)',referrer,outlet,worker,'migration'));
  assert (select not migration_credited from customers where id=referrer);
  perform pg_temp.must_fail(format('select claim_customer_bonus(%L,%L)',referrer,'install'));
  assert (select not install_bonus_given and installed_at is null from customers where id=referrer);
  update brands set stamps_per_reward=10 where id=b;
  update customers set spin_available=true where id=referrer;
  perform set_config('stampos.test_fail_events','on',true);
  perform pg_temp.must_fail(format('select claim_customer_bonus(%L,%L)',referrer,'spin'));
  assert (select spin_available and lifetime_stamps=1 from customers where id=referrer);
  perform set_config('stampos.test_fail_events','off',true);

  -- Manual adjustments: retry-safe, reject payload reuse, deny viewer and cross-brand target.
  result:=admin_adjust_customer(b,customer,actor,manual_req,'stamps',3,null,null);
  again:=admin_adjust_customer(b,customer,actor,manual_req,'stamps',3,null,null);
  assert (again->>'already_processed')::boolean;
  assert (select count(*)=1 from stamps where customer_id=customer and source='admin');
  perform pg_temp.must_fail(format('select admin_adjust_customer(%L,%L,%L,%L,%L,4,null,null)',b,customer,actor,manual_req,'stamps'));
  perform pg_temp.must_fail(format('select admin_adjust_customer(%L,%L,%L,%L,%L,1,%L,30)',b,customer,viewer,gen_random_uuid(),'reward','No'));
  perform pg_temp.must_fail(format('select admin_adjust_customer(%L,%L,%L,%L,%L,1,%L,30)',b,other_customer,actor,gen_random_uuid(),'reward','No'));
  manual_req:=gen_random_uuid();
  result:=admin_adjust_customer(b,customer,actor,manual_req,'reward',2,'Manual gift',30);
  again:=admin_adjust_customer(b,customer,actor,manual_req,'reward',2,'Manual gift',30);
  assert (again->>'already_processed')::boolean;
  assert (select count(*)=2 from rewards where customer_id=customer and type='manual');

  -- Invite state transitions preserve consumed rewards and cannot resurrect cancelled allocations.
  insert into influencer_grants(brand_id,handle,rewards_total,rewards_upfront) values(b,'@invite',4,1) returning id into g;
  perform pg_temp.must_fail(format('select accept_creator_grant(%L,%L)',g,other_customer));
  result:=accept_creator_grant(g,customer);
  assert (result->>'ok')::boolean and (result->>'upfront')::int=1;
  result:=accept_creator_grant(g,customer);
  assert not (result->>'ok')::boolean;
  result:=manage_creator_grant(g,b,actor,'verify');
  assert (result->>'unlocked')::int=3;
  result:=manage_creator_grant(g,b,actor,'verify');
  assert (result->>'unlocked')::int=0;
  select code into reward_code from rewards where grant_id=g limit 1;
  update staff set active=false where id=worker;
  perform pg_temp.must_fail(format('select redeem_reward(%L,%L,%L)',reward_code,outlet,worker));
  update staff set active=true where id=worker;
  perform pg_temp.must_fail(format('select redeem_reward(%L,%L,%L)',reward_code,other_outlet,worker));
  result:=redeem_reward(reward_code,outlet,worker);
  assert (result->>'ok')::boolean;
  result:=redeem_reward(reward_code,outlet,worker);
  assert not (result->>'ok')::boolean;
  result:=manage_creator_grant(g,b,actor,'cancel');
  assert (select count(*)=1 from rewards where grant_id=g and status='redeemed');
  assert (select count(*)=3 from rewards where grant_id=g and status='void');
  perform pg_temp.must_fail(format('select manage_creator_grant(%L,%L,%L,%L)',g,b,actor,'verify'));

  -- Functions and benefit ledgers are not directly accessible to public clients.
  assert not has_function_privilege('anon','public.admin_credit_creator(uuid,text,text,text,text,uuid,uuid)','execute');
  assert not has_function_privilege('authenticated','public.staff_issue_stamps(uuid,int,uuid,uuid,text)','execute');
  assert not has_function_privilege('anon','public.add_stamps(uuid,int,text,uuid,uuid,int,text,boolean)','execute');
  assert not has_table_privilege('authenticated','public.creator_benefits','select');
  assert (select count(*)=1 from events where brand_id=b and type='creator_four_bowls_credited');
  -- Relationship guards reject tenant mismatch, orphan grant, reassignment and brand moves.
  perform pg_temp.must_fail(format('insert into rewards(brand_id,customer_id,type,title) values(%L,%L,%L,%L)',b,other_customer,'manual','Wrong brand'));
  perform pg_temp.must_fail(format('insert into rewards(brand_id,customer_id,type,title,grant_id) values(%L,%L,%L,%L,%L)',b,customer,'influencer','Orphan',gen_random_uuid()));
  perform pg_temp.must_fail(format('update influencer_grants set customer_id=%L where id=%L',referrer,g));
  perform pg_temp.must_fail(format('update customers set brand_id=%L where id=%L',other_b,customer));
  raise notice 'database regression checks passed';
end $$;
rollback;
