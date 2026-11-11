-- LOCAL PostgreSQL only; all test records rolled back. No external senders.
\set ON_ERROR_STOP on
begin;
do $$
declare b uuid; c uuid; no_consent uuid; cp uuid; claim jsonb; again jsonb;
  n integer; ids uuid[]; sg date := (now() at time zone 'Asia/Singapore')::date;
begin
  insert into brands(slug,name) values('messaging-'||gen_random_uuid(),'Messaging test') returning id into b;
  insert into customers(brand_id,phone,name,marketing_consent,telegram_chat_id,birthday)
    values(b,'+6591000001','Consented',true,123,sg-interval '25 years') returning id into c;
  insert into customers(brand_id,phone,name,marketing_consent,birthday)
    values(b,'+6591000002','No consent',false,sg-interval '30 years') returning id into no_consent;

  -- Entitlements exist even for unreachable customers with NO consent.
  n:=messaging_issue_birthdays(b); assert n=2, 'Birthdays must not depend on consent';
  n:=messaging_issue_birthdays(b); assert n=0, 'Birthday retry must be idempotent';
  assert (select count(*)=2 from rewards where brand_id=b and type='birthday');
  assert (select birthday_reward_year=extract(year from sg) from customers where id=no_consent);
  update customers set birthday_reward_year=null where id=no_consent;
  n:=messaging_issue_birthdays(b); assert n=0, 'Unique birthday reward protects inconsistent legacy marker';

  -- Full audience is durable and not capped by the PostgREST 1,000-row default.
  insert into customers(brand_id,phone,name,marketing_consent,telegram_chat_id)
    select b,'+6581'||lpad(i::text,6,'0'),'Audience '||i,true,10000+i from generate_series(1,1205) i;
  insert into campaigns(brand_id,title,body,bonus_stamps) values(b,'Test','Not sent',2) returning id into cp;
  perform messaging_start_campaign(cp);
  assert (select status='sending' and audience=1206 from campaigns where id=cp);
  perform messaging_start_campaign(cp);
  assert (select count(*)=1206 from messaging_campaign_recipients where campaign_id=cp), 'Repeated campaign claim must not append audience';
  -- Remove consent after snapshot: neither message claim nor credit allowed.
  update customers set marketing_consent=false where id=c;
  update messaging_campaign_recipients set status='uncertain',claimed_at=now() where campaign_id=cp and customer_id=c;
  claim:=messaging_claim(c,b,'ignored','campaign',cp,false,0,2,'Test');
  assert claim is null;
  assert (select lifetime_stamps=0 from customers where id=c);
  update customers set marketing_consent=true where id=c;
  claim:=messaging_claim(c,b,'ignored','campaign',cp,false,0,2,'Test'); assert claim is not null;
  again:=messaging_claim(c,b,'different key cannot bypass','campaign',cp,false,0,2,'Test'); assert again is null;
  assert (select lifetime_stamps=2 from customers where id=c), 'Campaign bonus must issue exactly once';
  assert (select count(*)=1 from stamps where customer_id=c and source='campaign');

  -- Durable uncertain claim is NOT resent after process crash, regardless of key.
  assert (select status='uncertain' from messaging_claims where id=(claim->>'id')::uuid);
  assert (select count(*)=25 from messaging_campaign_batch(cp,1000)), 'Batch must be bounded to 25';
  select array_agg(x) into ids from messaging_campaign_batch(cp,25) x;
  assert array_length(ids,1)=25;
  assert not exists(select 1 from messaging_campaign_recipients where campaign_id=cp and customer_id=any(ids) and status='pending');
  perform messaging_finish_campaign(cp);
  assert (select status='sending' from campaigns where id=cp), 'Pending recipients must remain resumable';
  update messaging_campaign_recipients set status='skipped' where campaign_id=cp and status='pending';
  perform messaging_finish_campaign(cp);
  assert (select status='failed' and delivered=0 from campaigns where id=cp), 'Uncertain sends must pause, not claim delivery';
  assert (select count(*)=0 from messaging_campaign_batch(cp,25)), 'Failed/uncertain campaign must not automatically replay';

  -- Every automatic source shares the same Singapore-day guard.
  claim:=messaging_claim(c,b,'near:'||c,'near_reward',null,true,10,0,null); assert claim is not null;
  again:=messaging_claim(c,b,'window:'||c,'double_stamp',null,true,0,0,null); assert again is null;
  again:=messaging_claim(c,b,'creator:'||c,'influencer_due',null,true,0,0,null); assert again is null;
  assert (select sg_day=sg from messaging_claims where id=(claim->>'id')::uuid);
  -- A skipped operation is conservative too: no second automatic attempt today.
  update messaging_claims set status='skipped' where id=(claim->>'id')::uuid;
  again:=messaging_claim(c,b,'other:'||c,'lapsed',null,true,0,1,'No duplicate'); assert again is null;
  assert (select lifetime_stamps=2 from customers where id=c);
  -- Prior-day uncertainty blocks trigger cooldowns, even without notification log.
  update messaging_claims set sg_day=sg-1,created_at=now()-interval '1 day',status='uncertain' where id=(claim->>'id')::uuid;
  again:=messaging_claim(c,b,'retry-cooldown:'||c,'near_reward',null,true,10,0,null); assert again is null;

  -- Daily audience is complete and bounded; repeated batches are disjoint.
  select array_agg(x) into ids from messaging_auto_batch(b,10000) x;
  assert array_length(ids,1)=25;
  assert (select count(*)=1207 from messaging_auto_recipients where brand_id=b and sg_day=sg);
  assert not exists(select 1 from messaging_auto_batch(b,25) x where x=any(ids));

  -- Anonymous and authenticated clients cannot execute any new DEFINER RPC.
  assert not exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname like 'messaging_%' and p.prosecdef
    and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')));
  assert not exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname like 'messaging_%' and p.prosecdef
    and not has_function_privilege('service_role',p.oid,'execute'));
end $$;
rollback;
