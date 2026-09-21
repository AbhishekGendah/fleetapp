# Phase 1a, slice 2 — Admin login

Status: awaiting approval. Nothing built yet.

Goal: Abhi can sign in to the admin site with an email, a password and a
code from an authenticator app. Nobody else can.

## Decided: the login system gets its own database account

A third database role, `admin_auth_role`, used only by the login system.
It can read and write the login tables and nothing else. The existing
`admin_app_role` keeps running the rest of the admin app and is granted
nothing on the credential tables.

So a bug anywhere in the ordinary admin app — an Operator list, a search,
a report — cannot reach password hashes or authenticator secrets, because
the connection it runs on has no access to them.

Cost: one more database role and one more connection string in Vercel.

## What the library gives us

Better Auth with the two-factor plugin. Confirmed from its source and
docs, not assumed:

- Password hashes live in an `account` record, not on the user record.
- The authenticator secret and the recovery codes are encrypted before
  they are stored, using the app's signing secret.
- Lockout after repeated failures is built in: default 10 failed attempts,
  15 minutes locked.
- Recovery codes: 10 codes of 10 characters by default.

## Three things the library forces, which the design docs did not expect

1. **"Remember this device" is fixed at 30 days and cannot be changed.**
   docs/design/01 says 14 days. Recommendation for THIS slice: turn the
   feature off for Admins entirely, so an authenticator code is required
   on every single sign-in. Admins can reach every Operator; that is the
   right trade for a handful of AGS staff. The 14-versus-30 decision then
   only has to be made in slice 4, for Operators.

2. **The name shown inside the authenticator app has to come from
   somewhere**, and the product name is still undecided. It will be an
   environment variable, `AUTH_ISSUER_NAME`, so no brand name is
   hardcoded. Abhi picks the value when we set it in Vercel. It is
   awkward to change later: existing authenticator entries keep the old
   name until re-enrolled.

3. **A new secret, `BETTER_AUTH_SECRET`.** It encrypts the authenticator
   secrets and recovery codes. If it is ever lost or rotated, every Admin
   has to re-enrol their authenticator app. Separate values for the admin
   app and the Operator app. Goes in Vercel and Bitwarden, never in the
   repo.

## Database changes

### `admin_users` — columns added

| Column | Why |
|---|---|
| `email_verified` | Required by the library |
| `image` | Required by the library; unused in v1 |
| `two_factor_enabled` | Whether the authenticator app is set up |

The library's `name` is mapped onto the existing `full_name` column
rather than adding a second one.

### `admin_sessions` — new

`id`, `admin_user_id`, `token`, `expires_at`, `ip_address`,
`user_agent`, `created_at`, `updated_at`.

### `admin_accounts` — new

`id`, `admin_user_id`, `account_id`, `provider_id`, `password` (the
hash), `created_at`, `updated_at`, plus the library's social-login
columns (`access_token`, `refresh_token`, `id_token`,
`access_token_expires_at`, `refresh_token_expires_at`, `scope`). Those
stay empty in v1 — we only do email and password — but the library
expects the columns to exist.

### `admin_verifications` — new

`id`, `identifier`, `value`, `expires_at`, `created_at`, `updated_at`.
Backs password reset links.

### `admin_two_factors` — new

`id`, `admin_user_id`, `secret` (encrypted), `backup_codes`
(encrypted), `verified`, `failed_verification_count`, `locked_until`.

### `admin_activity_log` — new

Admin sign-ins, lockouts and failed attempts belong to AGS, not to any
Operator, so they cannot go in `activity_log`, which requires an
`operator_id`. Columns: `id`, `admin_user_id`, `action`, `ip_address`,
`occurred_at`. Append-only, same trigger as `activity_log`.

Never logged: passwords, codes, secrets or tokens (rule 7).

### Security on all of the above

Row-level security enabled and forced, as everywhere else.

- `admin_auth_role`: full access to the five login tables, nothing else.
- `admin_app_role`: reads `admin_users` (to list AGS staff) and
  `admin_activity_log`. Granted nothing on accounts, sessions,
  verifications or two-factor records.
- `web_app_role`: granted nothing on any of them.

## Creating the very first Admin

There is a chicken-and-egg problem: you need an Admin to create an
Admin.

Recommendation: a one-off command run from a Claude Code session using
the migration credentials, not a web page. It refuses to run if any
Admin already exists. Because it is never exposed on the internet, there
is no endpoint to find, guess or leave switched on by accident.

The alternative — a setup page behind a temporary token — is more
convenient and more attack surface. Not worth it for something done once.

## Tests

- `admin_app_role` cannot read `admin_accounts` or `admin_two_factors`.
- `admin_auth_role` cannot read `operators`, `users` or `activity_log`.
- `web_app_role` cannot read any admin login table.
- The first-Admin command refuses to run a second time.
- The structural guard still passes with the new tables.
- Sign-in fails without the authenticator code.

## Not in this slice

Operator invites and the Operator's own login are slices 3 and 4.
Password reset emails need the dev outbox from slice 3, so slice 2 sets
the tables up but leaves reset unfinished until then.

## Sources

- https://better-auth.com/docs/concepts/database
- https://better-auth.com/docs/plugins/2fa
- https://better-auth.com/docs/adapters/drizzle
