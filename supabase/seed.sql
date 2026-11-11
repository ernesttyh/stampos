-- Seed: Chengdu Bowl as the pilot brand.
-- Run AFTER 0001_schema.sql. Safe to re-run (upserts by slug).

insert into brands (slug, name, tagline, primary_color, accent_color, stamps_per_reward, stamp_label, reward_name,
                    reward_valid_days, max_stamps_per_visit, migration_until, migration_cap, ugc_agreement, pdpa_text)
values (
  'chengdu-bowl',
  'Chengdu Bowl',
  'Numbing, spicy, worth every stamp',
  '#C8102E',
  '#F2B134',
  10,
  'bowl',
  'Free bowl',
  60,
  6,
  (current_date + interval '60 days')::date,
  9,
  $ugc$By accepting, you agree to:
• Visit Chengdu Bowl and post at least 1 Reel/TikTok and 1 Story within the due date shown.
• Tag @chengdubowl and clearly disclose the meal was gifted (e.g. #gifted / "Gifted by Chengdu Bowl"), in line with ASAS guidelines.
• Allow Chengdu Bowl to reshare your content on its own channels, with credit.
Your first free bowl is unlocked now. The remaining bowls unlock once your post is live and verified by the team.$ugc$,
  $pdpa$By joining, you agree that Chengdu Bowl may store your name and mobile number to run this loyalty programme, and (if you tick the box) send you offers and reminders. You can opt out any time from your card.$pdpa$
)
on conflict (slug) do update set
  name = excluded.name, tagline = excluded.tagline, primary_color = excluded.primary_color,
  accent_color = excluded.accent_color, ugc_agreement = excluded.ugc_agreement, pdpa_text = excluded.pdpa_text;

-- Outlets (edit names/addresses to match the real ones)
insert into outlets (id, brand_id, name, address)
select '11111111-1111-4111-8111-111111111111', b.id, 'Chengdu Bowl — Main outlet', 'Edit address in Admin → Settings'
from brands b where b.slug = 'chengdu-bowl'
on conflict (id) do nothing;

-- Staff PINs. 1234 = counter staff, 8888 = manager. Change these from Admin → Settings → Staff.
insert into staff (brand_id, outlet_id, name, pin_hash, role)
select b.id, '11111111-1111-4111-8111-111111111111', 'Counter', '$2b$10$Tdy6CIJdNwSeSHLRIhc4a.FbiDJmvbgiqHHB8aJqSEARKOgcfZAka', 'staff'
from brands b where b.slug = 'chengdu-bowl'
  and not exists (select 1 from staff s where s.brand_id = b.id and s.name = 'Counter');

insert into staff (brand_id, outlet_id, name, pin_hash, role)
select b.id, null, 'Manager', '$2b$10$umL5PWEqjZAetW1Wml9d3u7bncVV1FzP.6r/RdelcBgDyGHkW/e3G', 'manager'
from brands b where b.slug = 'chengdu-bowl'
  and not exists (select 1 from staff s where s.brand_id = b.id and s.name = 'Manager');

-- Make yourself a platform admin AFTER you have signed up once at /admin/login
-- (sign-up creates the profiles row via trigger):
-- update profiles set is_platform_admin = true where email = 'YOUR_EMAIL@example.com';

-- Give a client user access to only their brand:
-- insert into brand_members (user_id, brand_id, role)
-- select p.id, b.id, 'owner' from profiles p, brands b where p.email = 'client@chengdubowl.sg' and b.slug = 'chengdu-bowl';
