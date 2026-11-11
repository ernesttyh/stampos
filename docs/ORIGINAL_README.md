# StampOS — digital stamp cards for restaurants

Multi-brand e-stamp loyalty platform. One Next.js app, three faces:

| Face | URL | Who uses it |
|---|---|---|
| Customer card (PWA) | `/<brand>` · join at `/<brand>/join` | Diners — stamp card, QR, rewards, lucky spin, levels, referral, reminders |
| Staff scanner | `/<brand>/staff` | Counter staff — outlet + PIN login, scan QR, add stamps, redeem, credit old paper cards |
| Admin dashboard | `/admin` | Brand owners and the agency — stats, customers, campaigns, double-stamp windows, creator seeding, settings, printable counter QR |

Plus: web push + Telegram (+ optional WhatsApp) nudges, scheduled automations, and an influencer module (invite link → free bowls → UGC → verification unlocks the rest).

Chengdu Bowl is seeded as the first brand (`/chengdu-bowl`). Adding another brand is a form in the admin.

---

## Deploy in ~20 minutes

### 1. Supabase
1. Create a project at supabase.com (Singapore region).
2. SQL Editor → paste and run `supabase/migrations/0001_schema.sql`, then `supabase/migrations/0002_lock_down_rpc.sql`, then `supabase/seed.sql`.
   (0002 revokes anon/authenticated access to the `add_stamps` / `redeem_reward` / `brand_stats` functions — without it anyone holding the public anon key could call them via REST.)
3. Authentication → URL Configuration → Site URL = your public app URL (so the sign-up confirmation email links back to the app).
   Optionally turn **off** "Confirm email" under Providers → Email for the pilot.
4. Project Settings → API Keys: copy the Project URL, anon key and service_role key.

### 2. Keys
```bash
npm install
npm run vapid            # prints a VAPID public/private key pair for web push
openssl rand -base64 48  # SESSION_SECRET
openssl rand -hex 24     # CRON_SECRET
```

### 3. Vercel
1. Push this folder to a Git repo and import it in Vercel (framework: Next.js, defaults are fine).
2. Add the environment variables from `.env.example` (all of them except the optional Telegram/WhatsApp ones).
   `NEXT_PUBLIC_APP_URL` must be the final public URL, e.g. `https://card.chengdubowl.sg`.
3. Deploy. `vercel.json` already schedules the daily nudge run (10:00 SGT).

### 4. Make yourself the platform admin
1. Open `https://<your-url>/admin/login`, create an account.
2. In the Supabase SQL editor:
   ```sql
   update profiles set is_platform_admin = true where email = 'you@yourdomain.com';
   ```
3. Reload `/admin` — you'll see Chengdu Bowl. Open **Settings** to fix the outlet name/address and replace the seeded staff PINs (`1234` staff, `8888` manager).
4. Give the client their own login: they create an account at `/admin/login`, then
   ```sql
   insert into brand_members (user_id, brand_id, role)
   select p.id, b.id, 'owner' from profiles p, brands b where p.email = 'client@chengdubowl.sg' and b.slug = 'chengdu-bowl';
   ```

### 5. Go live at the counter
- **Print QR** in the admin prints a counter card pointing at `/chengdu-bowl/join`.
- Staff open `/chengdu-bowl/staff` on any phone or tablet, pick the outlet, enter the PIN. Save it to the home screen.

### Optional channels
- **Telegram** (free, recommended as the backup channel): create a bot with @BotFather, set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, redeploy, then register the webhook once:
  ```
  https://api.telegram.org/bot<TOKEN>/setWebhook?url=<NEXT_PUBLIC_APP_URL>/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
  ```
  The card then shows a "Prefer Telegram?" button.
- **WhatsApp** (paid per message): Meta Cloud API number + an approved marketing template with one `{{1}}` body variable. Set the three `WHATSAPP_*` vars. Only customers with marketing consent *and* `whatsapp_opt_in = true` are messaged.

### Scheduling nudges with n8n instead of Vercel Cron
Schedule Trigger (hourly is fine; every trigger de-duplicates) → HTTP Request `GET <NEXT_PUBLIC_APP_URL>/api/cron/nudges` with header `Authorization: Bearer <CRON_SECRET>`. The response summarises what was sent per brand.

---

## How it works

**Stamping.** Customer shows their QR (`SO:<customer id>`). Staff scan it, pick the number of bowls, tap. `add_stamps()` in Postgres inserts the ledger row, updates balances and mints a reward each time the card fills — atomically. The customer's open card receives a Realtime broadcast and animates the stamps the same second (and polls every 8s as a fallback).

**Bonuses** (all switchable per brand in Settings):
- *Double-stamp windows* — scheduled in Nudges; staff stamps are multiplied automatically; members are told a few hours before.
- *Lucky spin* — after every staff stamp the customer gets one spin; 1-in-N (default 5) wins a bonus stamp. The server decides, the client animates.
- *Streak* — came back 4–14 days after the previous visit: +1 (max once per 5 days).
- *Bring a friend* — join link `?ref=CODE`; on the friend's first staff stamp, both get +1.
- *Home screen* — opening the card from the home screen once gives +1 (this is what makes iPhone push possible).
- *Birthday* — a reward on their birthday (if they gave one), once a year, valid 30 days.
- *Levels* — lifetime stamps unlock named tiers with perks; edit the JSON in Settings.

**Old paper cards.** Until `migration_until`, staff can credit up to `migration_cap` stamps once per customer from the scanner ("Credit stamps from an old paper card").

**Nudges** (`/api/cron/nudges`, once a day by default): close to a reward (≤2 away, once per 10 days) → gone quiet 14–60 days (+1 bonus stamp, once per 21 days) → reward expiring within 7 days → birthday → double-stamp announcements → creator content due in 3 days. Each customer gets at most one automatic nudge per run, and only if they ticked marketing consent. Channel order: push → Telegram → WhatsApp.

**Campaigns.** Nudges → "Send a campaign": pick a segment (everyone / close to reward / gone quiet / creators / push-only / Telegram-only), optionally attach bonus stamps, send now or save a draft.

**Creators.** Creators → New invite: handle, platform, total free bowls (default 4), how many unlock on accept (default 1), due date, deliverable. Copy the invite link and DM it. The creator opens it, accepts the agreement (brand default text is in Settings; mentions ASAS "gifted" disclosure), and gets a card with 1 bowl available and 3 locked. When their post is live, paste the URL and hit **Verify & unlock** — the locked bowls flip to available and they get a notification. Cancel voids any unused bowls.

**Multi-brand.** Everything is keyed by `brand_id`. Platform admins see all brands; brand members see only theirs. Each brand has its own slug, colours, rules, outlets, staff PINs, PWA manifest and app icon (`/api/icon/<slug>`).

---

## Testing it on your phone (5 minutes)
1. Open `/chengdu-bowl/join` on your phone, sign up.
2. On a second device open `/chengdu-bowl/staff`, log in with the outlet + `1234`, scan the QR on the first phone, add 3 stamps → watch them drop in live; tap the lucky spin.
3. Add stamps until the card fills → confetti → Rewards tab shows a free bowl → scan again on the staff device → Redeem.
4. Admin → Creators → create an invite, open the link in a private window, accept → Rewards tab shows 1 available + 3 locked → Verify in admin → they unlock.
5. Admin → Nudges → schedule a double-stamp window starting in 10 minutes, then stamp again → 2× applied.
6. To test push on iPhone: Save to home screen first, open from there, then "Turn on" reminders. Send a campaign to "Push subscribers only".

---

## Project structure
```
supabase/migrations/0001_schema.sql   tables, add_stamps()/redeem_reward()/brand_stats(), RLS
supabase/migrations/0002_lock_down_rpc.sql  revoke anon/authenticated EXECUTE on the SECURITY DEFINER functions
supabase/seed.sql                     Chengdu Bowl brand, outlet, staff PINs
src/app/[brand]/                      customer card, join, invite, staff login + scanner, manifest
src/app/admin/                        dashboard (Supabase Auth), server actions in actions.ts
src/app/api/card/*                    customer endpoints (signup, spin, install, push, invite)
src/app/api/staff/*                   scanner endpoints (login, lookup, stamp, redeem, migrate)
src/app/api/cron/nudges               scheduled automations
src/app/api/telegram/webhook          Telegram bot
src/lib/loyalty.ts                    stamping, bonuses, spin, redemption, card payload
src/lib/nudges.ts                     automations + campaign sending
src/lib/notify.ts                     channel fan-out (push → Telegram → WhatsApp) + log
src/components/card/*                 the customer UI (StampGrid animations, SpinWheel, PushToggle, InstallPrompt)
src/components/staff/Scanner.tsx      the counter UI
public/sw.js                          service worker for web push
```

## Security notes and sensible next steps
- Customers log in with name + phone (no OTP) — fine for a stamp card because redemptions happen in person via a staff scan. If you later want OTP, the cleanest path is a WhatsApp OTP template on the same Cloud API number; add a `verified_at` column and require it for rewards.
- Staff sessions last 14 hours; manager PINs work at any outlet. PINs are bcrypt-hashed. Rotate the seeded PINs before launch.
- All DB access is server-side with the service role; RLS blocks the anon key everywhere. Realtime uses public broadcast channels named by customer id (only stamp counts travel over them, no personal data).
- Accidental double-taps on the scanner are ignored within 20 seconds; spins and install bonuses are claimed atomically.
- Later: POS integration to auto-stamp from receipts, receipt codes so GrabFood orders earn stamps, SMS fallback (check the DNC registry first), per-outlet stats.
