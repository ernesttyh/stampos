# StampOS

Multi-brand restaurant loyalty cards: customer mobile card, staff scanner and brand admin. Chengdu Bowl is the seeded pilot. This is not a POS/payment integration.

## Launch-safety release

The launch-hardening branch adds verified-phone customer access, current staff access checks, role enforcement, transactional/idempotent reward operations, audited creator phone allocations, conservative messaging retries and repeatable tests. **A passing build is not live launch approval.** See [`docs/LAUNCH.md`](docs/LAUNCH.md).

### Creator accounts: four complimentary bowls (any brand)

1. Sign in as a platform admin or the brand's owner/manager.
2. Open `/admin/chengdu-bowl/creators`.
3. Under **Create creator account · 4 complimentary bowls**, enter name, mobile number, handle and platform.
4. Submit once. The server creates/reuses the brand-specific phone account, tags it as a creator and issues four separate available rewards in one transaction.
5. Read the confirmation and open the account history. The same phone cannot receive this allocation again through retries or repeated submissions.
6. The creator opens `/chengdu-bowl/join` and verifies the same phone to access the card. Staff redeem each reward through the scanner.

No automatic invitation/SMS/marketing message is sent by the admin credit form. Existing customer names, consent and balances are preserved. Existing legacy creator deals require review rather than silently adding another allocation. Reward expiry follows the brand's current `reward_valid_days`, displayed before crediting. This four-bowl flow has no content-unlock condition. The optional content-based invitation form remains a separate deal and may add extra rewards if intentionally used.

## Setup

### Database

Use a dedicated isolated test project first. Apply SQL migrations **in filename order**:

1. `0001_schema.sql`
2. `0002_lock_down_rpc.sql`
3. `0003_launch_safety.sql`
4. `0004_auth_safety.sql`
5. `0005_messaging_safety.sql`

On an existing installation, verify the definitions of the first two already-applied migrations; do not blindly reapply them or reseed data. Migration 0003 aborts on incompatible historical tenant relationships rather than rewriting records. Back up before approved production migrations.

`supabase/seed.sql` is for a fresh test database only. It seeds two staff PINs (`1234` counter, `8888` manager). PINs are 4–8 digits; the owner decides how simple they are. Staff can be deactivated in Settings, which immediately rejects their old sessions.

### Environment

Copy `.env.example` to a private local environment file. Never commit real keys.

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`: this environment's actual origin, not the production origin for a test deployment
- `SESSION_SECRET`: strong random secret, at least 32 characters; rotating it invalidates signed sessions
- `CRON_SECRET`: strong random bearer secret
- `CUSTOMER_PHONE_OTP_ENABLED=true` **only after** configuring and testing the Supabase phone/SMS provider, abuse limits and spend controls
- `AUTOMATIC_NUDGES_ENABLED=false` until explicit end-to-end approval
- Optional web push VAPID, Telegram webhook/bot and WhatsApp template settings

Verified phone login fails closed with a setup message when OTP is unavailable. There is deliberately no name-and-phone fallback. Supabase phone authentication needs an enabled phone provider and configured SMS transport; SMS usage can incur charges. No OTP or verification code should be shared in support chat or logs.

Customer and staff cookie names are versioned to invalidate older insecure sessions. Customers will need to sign in again after this release.

### Install and checks

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

SQL regression/concurrency tests run against an explicitly configured **disposable local database only**. Review `tests/database_bootstrap.sql` and the scripts in `tests/` before execution. The bootstrap creates Supabase auth stubs for local PostgreSQL; it is not a production migration. JavaScript tests include pure functions and source-regression guards; they do not replace real SMS/scanner/device tests.

### Admin access

Admins use Supabase Auth. Membership roles are `owner`, `manager`, `viewer`:

- Platform admin: all brands and platform administration.
- Owner: programme settings, outlets/staff and operational management for their brand.
- Manager: customer/reward/creator/campaign operations for their brand, not staff or programme settings.
- Viewer: read-only access for their brand.

Provision admin membership through an authorized administrator. Never expose the service-role key to a browser.

## Messaging safeguards

Campaign dispatch is bounded and resumable using durable recipient records. Provider acceptance is displayed as **accepted/sent**, not confirmed delivery. A timed-out or interrupted attempt is conservatively marked uncertain and not blindly resent. Manual reconciliation is required for uncertain attempts; do not reset records just to retry.

Automatic marketing reminders are off by default, use explicit Singapore dates/times and permit at most one automatic attempt per customer per Singapore day. Birthday reward entitlement is separate from marketing consent and reminder selection. Reward expiry and entitlement housekeeping can still run with marketing disabled. Campaigns are separately admin-initiated; starting a campaign is an external communication action requiring approval.

Telegram linking uses a short-lived signed one-time token, not a raw customer ID. The webhook rejects requests if its verification secret is absent or incorrect. Push endpoints are restricted to reviewed HTTPS browser-push providers.

## Routes

| Interface | Route |
|---|---|
| Customer | `/<brand>`, `/<brand>/join`, `/<brand>/rewards` |
| Staff | `/<brand>/staff`, `/<brand>/staff/scan` |
| Admin | `/admin`, `/admin/<brand>/creators` |
| Scheduled housekeeping | `/api/cron/nudges` with the required bearer secret |

Preview sites must remain protected and unindexed. Keep test databases and outbound channels separate from production. Never validate with real customer rewards or notifications without approval.
