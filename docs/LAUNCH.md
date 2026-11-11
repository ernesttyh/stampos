# Launch checklist and release procedure

## Go/no-go

Do not call the release live merely because a branch builds. Production changes, SMS setup/charges, migration execution, real notifications and account credits require approval. No actual creator allocation is part of the code change; the admin form is the controlled entry point.

### Before staging

- [ ] Confirm the reviewed branch/commit and preserve the previous production deployment ID.
- [ ] Back up the production database and verify how to restore it.
- [ ] Compare live schema with the baseline migrations; preserve any changes outside this repository.
- [ ] Apply 0003–0005 to an isolated database and record successful test results.
- [ ] Create a protected no-index test deployment with isolated DB credentials and outbound messaging disabled.
- [ ] Verify OTP SMS provider configuration and authorization for any SMS charges; set spend/rate controls before enabling.
- [ ] Set a strong session secret and cron bearer secret; keep them out of logs/repository.

### Required acceptance tests

- [ ] New customer phone verification; wrong/expired/reused OTP and request limits.
- [ ] Existing customer logs in only after phone verification; previous name-and-phone login/session no longer works.
- [ ] Creator by local/+65-formatted phone creates one account and exactly four available rewards.
- [ ] Repeated and parallel creator submissions add no extra allocation; existing legacy deals direct staff to review.
- [ ] Existing customer name, consent, stamp balance and unrelated rewards remain unchanged.
- [ ] Creator sees all four rewards, expiry and QR after phone verification; separate staff redemption decreases available rewards from four to three.
- [ ] Concurrent redemption uses a reward only once; wrong-brand staff cannot read/redeem it.
- [ ] Staff deactivation/outlet deactivation immediately rejects the old session.
- [ ] Viewer cannot mutate records; manager cannot change programme/staff; owner acts only within their brand.
- [ ] Repeated stamp, migration, referral, spin and manual-adjustment requests do not multiply benefits.
- [ ] Actual iPhone/Android camera scanning, home-screen flow and cross-device card refresh.
- [ ] Consent withdrawal prevents new marketing attempts; push/Telegram linking and opt-out use test recipients only.
- [ ] Timeout/uncertain campaign attempts remain auditable and are not automatically resent.

### Approved production rollout

1. Record approval, backup reference and current deployment/DB migration state.
2. Schedule a brief maintenance window. Verify no in-flight reward writes before schema/application transition.
3. Apply additive migrations in order; do not reseed or delete existing rewards/customers.
4. Configure provider/environment gates only for verified services.
5. Deploy the reviewed commit; confirm the actual production alias points to that deployment.
6. Confirm admin login, correct brand isolation and scanner readiness without issuing real rewards unless separately authorized.
7. Complete a separately approved end-to-end test, reconcile every record created and record sign-off before opening to customers.

### Rollback

Keep automatic marketing off during rollout. If the app fails, stop access/dispatch and restore the previous deployment only after checking schema compatibility and the security consequences of restoring its old login behaviour. Prefer a maintenance screen over reopening insecure login. Migrations are additive: do not drop tables, delete audit history, reset idempotency records or reverse balances as an improvised rollback. Database restoration is a separately approved operation and must account for writes since the backup.

### Known operational limits

- SMS transport/provider readiness and actual mobile delivery must be verified outside local tests.
- Notification API acceptance is not proof of delivery or reading.
- Conservative at-most-once message claims can leave a missed/uncertain message after a crash; investigate rather than auto-resend.
- Four-bowl creator expiry inherits the existing brand programme validity; confirm that setting before crediting.
- There is no POS/sale-receipt integration in this release. Staff still authorize stamps/redemption in person.
