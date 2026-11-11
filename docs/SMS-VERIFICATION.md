# Customer SMS verification

Customer access fails closed unless `CUSTOMER_PHONE_OTP_ENABLED=true`. There is
no unverified login, alternate-provider retry, voice or WhatsApp fallback.

## Direct Twilio Verify (Singapore launch)

1. Use the approved existing Twilio account, with a **separate StampOS Verify
   service**. Configure six-digit SMS codes, custom codes off, and the
   do-not-share warning on. Do not enable paid Lookup for this integration.
   Check Singapore delivery/registration requirements and account permissions
   with Twilio before enabling production traffic. Enable appropriate Twilio
   geographic restrictions and fraud controls in the console.
2. Set these **server-only** deployment variables through the hosting secret
   manager (never source control, public env vars, client code, logs or screenshots):
   `CUSTOMER_PHONE_OTP_PROVIDER=twilio_verify`, `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`.
3. Keep the existing Supabase application/database configuration and apply
   migration `0004_auth_safety.sql` (and the normal migration sequence). Direct
   Verify bypasses Supabase **phone authentication**, not the durable database
   limiter or customer storage. No additional Supabase Auth phone user is created.
   All deployments sharing this database share the counters below.
4. Set `CUSTOMER_PHONE_OTP_DAILY_SEND_LIMIT=100` or a smaller positive integer.
   Invalid/empty configuration fails closed. Keep `CUSTOMER_PHONE_OTP_ENABLED=false`
   until an explicitly approved real-device test and deployment review.
5. Configure `AUTH_TRUSTED_IP_HEADER` only for a header your deployment proxy
   overwrites; otherwise all requests use the conservative shared `unknown` IP
   bucket. Never trust arbitrary client-supplied forwarding headers.

Only normalized `+65[89]` followed by seven digits is supported: an eight-digit
Singapore mobile number starting with 8 or 9. Local numbers are normalized to
`+65`. Other destinations are rejected with a friendly message before sending
or consuming the paid-call reservations.

The server POSTs form-encoded `To`, `Channel=sms`, `Locale=en` to Twilio
`/v2/Services/{ServiceSid}/Verifications`, then `To`, `Code` to
`/VerificationCheck`, using account SID/Auth Token Basic authentication. No
Lookup or alternate channel is requested. The send response must be `pending`;
verification must be exactly `approved` with a matching normalized `to` and
the configured `service_sid`. `valid=true` alone is never enough. Malformed,
mismatched, pending, HTTP-error and timed-out checks cannot create a proof.
Each operation has an eight-second timeout, including response parsing, and
does not retry. A timed-out send may nevertheless have reached Twilio: do not
automatically resend. An explicit later customer resend is a new counted attempt.

The existing signed ten-minute, brand/phone/nonce-bound challenge and proof
cookies remain the only bridge to the card session. Twilio credentials and
raw provider responses never leave the server or become a customer session.

## Durable abuse and cost controls

Every direct send must pass the existing atomic `authThrottle` database RPC:

| Bucket | Limit | Window/key |
| --- | --- | --- |
| Normalized phone sends | 3 | 15-minute database window |
| Trusted IP sends | 15 | 15-minute database window |
| Whole application sends | 100 default, configurable | Singapore calendar date, UTC+8 midnight reset |
| Verify service sends | 30 | One-hour database window, stable service SID key |
| Phone verification checks | 8 | 10-minute database window |
| Trusted IP verification checks | 40 | 10-minute database window |

The database windows start on first consumption, not at wall-clock hour boundaries
and are not sliding windows. The service key does not include a challenge, phone,
brand, or deployment nonce. The daily application key does not include a service
SID; changing services cannot reset that day's application bucket. Date-keyed
daily rows use a 48-hour retention window so they cannot reset during that date.
All application instances must use the same durable Supabase database for shared
enforcement; these controls do not cover other software using the Twilio account.

Reservations are consumed **before** a paid API call and never refunded for
failure, timeout, or an uncertain result. Sequential bucket checks can reserve
daily capacity even when the later service bucket denies the send. Database
errors fail closed; there is no in-memory fallback. Concurrent requests are
serialized by the existing atomic database RPC.

These are **application send-attempt limits, not a guaranteed dollar cap**.
Provider pricing, verification fees, SMS segments, delivery retries, taxes,
other account traffic and boundary bursts can affect actual billing. Monitor
Twilio usage and billing, and use provider-side restrictions/alerts as additional
controls. Singapore midnight can permit activity on both sides of a day boundary;
the service-hour bucket still applies. Do not represent an indicative per-SMS
price multiplied by 100 as a guaranteed maximum bill.

## Existing Supabase provider and rollback

Unset `CUSTOMER_PHONE_OTP_PROVIDER` (or set `supabase`) to retain the existing
anonymous-client Supabase phone auth flow; configure its SMS provider separately.
Unknown provider names fail closed. Twilio failures never fall back to Supabase.
To close customer access immediately, set `CUSTOMER_PHONE_OTP_ENABLED=false`;
this also refuses outstanding proofs. Changing providers is an explicit operator
configuration action, not an automatic recovery path.

## Validation

Run `npm test`, `npm run lint`, `npm run typecheck`. Unit and integration tests
inject offline transports/mocks and must not use real credentials or send SMS.
Then perform only an approved isolated live test: send once to an owned Singapore
mobile, confirm the code, verify the matching customer card and unrelated-number
rejection, and inspect usage without exposing credentials or OTPs. Deployment,
service creation and live testing are separate approved operator actions.

Official API references:
- https://www.twilio.com/docs/verify/api/verification
- https://www.twilio.com/docs/verify/api/verification-check
