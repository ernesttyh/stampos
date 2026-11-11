# Admin invitation and password setup

For the current dashboard invitation UI (which has no redirect field), configure Supabase Auth's **Site URL** as `https://stampos-loyalty.vercel.app/admin/set-password`. This is the default landing URL used by dashboard invitation emails. Add these exact **Redirect URLs** (and explicit localhost equivalents only for development):

- `https://stampos-loyalty.vercel.app/auth/callback`
- `https://stampos-loyalty.vercel.app/admin/set-password`

Default Supabase invitation/recovery emails verify with Supabase first, then deliver an access/refresh-token fragment to the configured Site URL. The callback route also supports this flow and always continues to `/admin/set-password`. A path-bearing Site URL is intentional here; it affects all Auth emails that omit an explicit redirect. If other email-auth flows are introduced, supply explicit redirects or use custom invitation/recovery templates instead of relying on a global default. Phone-only customer authentication is unaffected by this email landing URL.

For custom invitation/recovery templates that verify token hashes in the app, use `https://YOUR_HOST/auth/callback?token_hash={{ .TokenHash }}&type=invite` (or `type=recovery` for password resets). Keep each template's type correct. PKCE callbacks with `?code=...` are supported when the same browser initiated the flow and still has its code-verifier cookie; dashboard invitations should use the default fragment flow or the token-hash template, not rely on PKCE from another browser.

Only valid Supabase sessions can update a password. The browser client writes the same SSR cookies used by existing admin authentication. Credentials are removed from the address bar before exchange, passwords are never placed in URLs or logs, and successful password setup goes to `/admin`. The form requires at least 12 characters and matching confirmation; Supabase may enforce additional password rules. Expired/invalid links show a generic message asking for a new link. An already authenticated user may also use `/admin/set-password` to change their password.

This flow does **not** assign platform or brand roles, disable verification, or create users. Provision the approved user's permissions separately through trusted administration/SQL. Existing role checks remain authoritative. Use HTTPS, do not add third-party analytics to these pages, and avoid retaining callback query strings in infrastructure logs (token hashes/codes are credentials). No external configuration changes were made by this implementation.

Before production invitation: deploy these pages, configure the URLs/templates, then check a real invitation in a fresh browser: email → set password → `/admin`, followed by sign-out/sign-in. Also check an expired/reused link and a recovery email. Local regression: `node --test tests/admin-onboarding.test.mjs` (requires installed TypeScript dependency).
