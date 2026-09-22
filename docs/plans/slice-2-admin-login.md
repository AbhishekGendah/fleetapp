# Phase 1a, slice 2 — Admin login

Status: built. What follows is what was built, with the two
corrections found while building it marked.

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

1. **"Remember this device".** CORRECTED WHILE BUILDING: the published
   docs say the 30-day period cannot be changed, but version 1.7.5 takes
   a `trustDeviceMaxAge` option, and reading the source confirms a value
   of zero is honoured rather than falling back to the default. So the
   14 days in docs/design/01 IS achievable for Operators in slice 4.

   For Admins it is set to zero: the feature is off, and an authenticator
   code is required on every single sign-in. An Admin reaches every
   Operator; that is the right trade for a handful of AGS staff.

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

Admin sign-ins belong to AGS, not to any Operator, so they cannot go in
`activity_log`, which requires an `operator_id`. Columns: `id`,
`admin_user_id` (null when the attempt names nobody), `action`,
`ip_address`, `occurred_at`. Append-only, same trigger as `activity_log`.

Never logged: passwords, codes, secrets or tokens (rule 7). `ip_address`
is recorded because an audit trail that cannot answer "from where" is
close to useless after an incident, and Better Auth stores it against
each session regardless. Rule 7 is about Renters' details — licences,
bank accounts — not an audit trail of AGS's own staff.

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

Built as `apps/admin/scripts/create-first-admin.ts`, run by hand, not a
web page. It refuses to run if any Admin already exists. Because it is
never exposed on the internet, there is no endpoint to find, guess or
leave switched on by accident.

The password is read from stdin rather than from the command line, so it
does not reach the shell history or the process list. It is hashed by the
login system's own hasher, so sign-in verifies it exactly as it would any
other password.

The alternative — a setup page behind a temporary token — is more
convenient and more attack surface. Not worth it for something done once.

## Tests

Database boundary (`packages/db`):

- `admin_app_role` cannot read `admin_accounts` or `admin_two_factors`.
- `admin_auth_role` cannot read `operators`, `users` or `activity_log`.
- `web_app_role` cannot read any Admin table.
- No role can remove an Admin's credential record.
- The structural guard still passes, and DELETE is granted only on the
  tables named as transient.

The login itself (`apps/admin`), against a real Postgres with the real
migrations applied, because the mapping between Better Auth's models and
this schema's tables fails silently everywhere except at the moment
someone tries to sign in:

- Signing in with the right password works; the wrong one does not; an
  unknown email does not.
- Nobody can sign themselves up.
- A sign-in writes a line to the Admin activity log.
- Once an authenticator is enrolled, a password alone stops being a way
  in, and a real generated code completes the sign-in.

Breaking one field mapping fails three of those tests.

## Not in this slice

Operator invites and the Operator's own login are slices 3 and 4.
Password reset emails need the dev outbox from slice 3, so slice 2 sets
the tables up but leaves reset unfinished until then.

## Sources

- https://better-auth.com/docs/concepts/database
- https://better-auth.com/docs/plugins/2fa
- https://better-auth.com/docs/adapters/drizzle
