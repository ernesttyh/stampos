-- LOCAL ONLY: bootstrap tests/database_bootstrap.sql, then migration 0004.
-- Run with psql -v ON_ERROR_STOP=1 -d stampos_auth_test -f this-file.sql.
-- Everything below rolls back, including fixtures and temporary assertion helper.
begin;
create function pg_temp.auth_assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'AUTH ASSERTION FAILED: %', message; end if; end $$;

do $$
declare
  b uuid := gen_random_uuid(); b2 uuid := gen_random_uuid();
  o uuid := gen_random_uuid(); o2 uuid := gen_random_uuid();
  s uuid := gen_random_uuid(); c uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  k text := encode(gen_random_bytes(32),'hex');
  token text := encode(gen_random_bytes(32),'hex');
  v integer;
begin
  insert into brands(id,slug,name) values(b,'auth-test-'||b,'Auth Test'),(b2,'auth-test-'||b2,'Other Brand');
  insert into outlets(id,brand_id,name) values(o,b,'First'),(o2,b,'Second');
  insert into staff(id,brand_id,outlet_id,name,pin_hash) values(s,b,o,'Worker','original-hash');
  insert into customers(id,brand_id,name,phone) values(c,b,'Preserved Customer','+6591234567');

  -- Supabase phone-only users have null email: trigger must create a non-admin profile.
  insert into auth.users(id,email,raw_user_meta_data) values(u,null,'{}'::jsonb);
  perform pg_temp.auth_assert(exists(select 1 from profiles where id=u and email is null and not is_platform_admin),'phone-only user creates non-admin profile without email');
  perform pg_temp.auth_assert(not exists(select 1 from brand_members where user_id=u),'phone signup grants no brand/admin membership');
  raise notice 'PASS: phone-only auth user trigger supports nullable email, no admin membership';

  select auth_version into v from staff where id=s;
  perform pg_temp.auth_assert(v=1,'initial staff auth version');
  update staff set name='New display name' where id=s;
  perform pg_temp.auth_assert((select auth_version=v from staff where id=s),'display-only change does not revoke');
  update staff set pin_hash='rotated-hash' where id=s; v:=v+1;
  perform pg_temp.auth_assert((select auth_version=v from staff where id=s),'PIN rotation revokes old version');
  update staff set outlet_id=o2 where id=s; v:=v+1;
  perform pg_temp.auth_assert((select auth_version=v from staff where id=s),'outlet reassignment revokes');
  update staff set outlet_id=null where id=s; v:=v+1;
  perform pg_temp.auth_assert((select auth_version=v from staff where id=s),'brand-wide reassignment revokes');
  update staff set role='manager' where id=s; v:=v+1;
  perform pg_temp.auth_assert((select auth_version=v from staff where id=s),'role change revokes');
  update staff set active=false where id=s; v:=v+1;
  perform pg_temp.auth_assert((select auth_version=v from staff where id=s),'deactivation revokes');
  update staff set active=true where id=s; v:=v+1;
  perform pg_temp.auth_assert((select auth_version=v from staff where id=s),'reactivation does not restore old cookie version');
  update staff set brand_id=b2 where id=s; v:=v+1;
  perform pg_temp.auth_assert((select auth_version=v from staff where id=s),'brand reassignment revokes');
  raise notice 'PASS: PIN/active/reactivation/brand/outlet/role changes increment staff auth version';

  perform pg_temp.auth_assert(consume_auth_attempt(k,2,600),'first attempt admitted');
  perform pg_temp.auth_assert(consume_auth_attempt(k,2,600),'second attempt admitted');
  perform pg_temp.auth_assert(not consume_auth_attempt(k,2,600),'third attempt denied');
  update auth_attempts set window_started=clock_timestamp()-interval '601 seconds' where key_hash=k;
  perform pg_temp.auth_assert(consume_auth_attempt(k,2,600),'expired window admits attempt');
  perform pg_temp.auth_assert((select attempts=1 from auth_attempts where key_hash=k),'expired window resets count atomically');
  perform pg_temp.auth_assert(not consume_auth_attempt(k,0,600),'invalid zero limit denied');
  raise notice 'PASS: throttle limits, invalid limit and window reset';

  insert into telegram_link_tokens values(token,c,clock_timestamp()-interval '1 second');
  perform pg_temp.auth_assert(consume_telegram_link(token,123456) is null,'expired link rejected');
  perform pg_temp.auth_assert((select telegram_chat_id is null from customers where id=c),'expired link did not mutate account');
  update telegram_link_tokens set expires_at=clock_timestamp()+interval '10 minutes' where token_hash=token;
  perform pg_temp.auth_assert(consume_telegram_link(token,-123) is null,'group chat rejected');
  perform pg_temp.auth_assert(consume_telegram_link(token,null) is null,'null chat rejected without consuming');
  perform pg_temp.auth_assert(consume_telegram_link(token,123456)=c,'valid link consumed');
  perform pg_temp.auth_assert(not exists(select 1 from telegram_link_tokens where token_hash=token),'token deleted on success');
  perform pg_temp.auth_assert(consume_telegram_link(token,999999) is null,'replay rejected');
  perform pg_temp.auth_assert((select telegram_chat_id=123456 from customers where id=c),'replay cannot relink customer');
  perform pg_temp.auth_assert(consume_telegram_link(c::text,999999) is null,'raw customer UUID rejected');
  perform pg_temp.auth_assert((select not marketing_consent and name='Preserved Customer' from customers where id=c),'linking does not enable marketing or rename customer');
  raise notice 'PASS: Telegram expiry, invalid chat, single use, raw ID rejection, profile/consent preservation';

  perform pg_temp.auth_assert(not has_function_privilege('anon','public.consume_auth_attempt(text,integer,integer)','execute'),'anon cannot consume limiter');
  perform pg_temp.auth_assert(not has_function_privilege('authenticated','public.consume_telegram_link(text,bigint)','execute'),'authenticated cannot consume linking token');
  perform pg_temp.auth_assert(has_function_privilege('service_role','public.consume_auth_attempt(text,integer,integer)','execute'),'service role limiter access');
  perform pg_temp.auth_assert(has_function_privilege('service_role','public.consume_telegram_link(text,bigint)','execute'),'service role link access');
  perform pg_temp.auth_assert(not has_table_privilege('anon','public.telegram_link_tokens','select'),'anon cannot read token hashes');
  perform pg_temp.auth_assert(not has_table_privilege('authenticated','public.auth_attempts','update'),'authenticated cannot reset limiter');
  raise notice 'PASS: authentication helper permissions deny public clients';
end $$;
rollback;
