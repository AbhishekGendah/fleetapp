# Phase 1a, slice 4 — Operator sign-in

Status: planned, awaiting approval.

Goal: the person invited in slice 3 can open their invite link, choose a
password, set up an authenticator app and save recovery codes. From then
on they can sign in, optionally have their device remembered for 14
days, reset a forgotten password by email, and get an email when someone
signs in from a new device. Too many wrong passwords or codes locks the
login for a while. A suspended Operator's Users cannot get in.

Built in two parts, each deployed and tested on its own:

- **4a:** accepting the invite, signing in, the authenticator, trusted
  devices, lockout, suspension.
- **4b:** password reset by email, and the new-device email.

## Decided: the same shape as the admin login

Slice 2's choices carry over, so the two logins work alike:

- Better Auth with the two-factor plugin. Authenticator app mandatory:
  nobody uses the Operator app before setting one up.
- **A fourth database role, `web_auth_role`, used only by the Operator
  login system.** It reaches the login tables; `web_app_role`, which runs
  the rest of the Operator app, is granted nothing on them. A bug in a
  vehicle list or a report has no connection on which a password hash or
  authenticator secret is readable. Cost: Abhi creates one more role in
  Neon and adds its connection string in Vercel.
- Nobody can sign up. The only way to get a login is an invite.

## What the library does and does not give us

Checked in Better Auth 1.7.5's source, not assumed:

- **"Remember this device" for 14 days**: supported (`trustDeviceMaxAge`).
  Off by default on each sign-in; the person ticks a box to turn it on.
- **Lockout after wrong authenticator codes**: built in, as for Admins.
- **Lockout after wrong passwords: NOT built in.** Its only defence is
  rate limiting, and that is kept in each server's memory by default.
  On Vercel that is close to no protection: there are many servers and
  they restart constantly. So we build a small lockout of our own, kept
  in the database: **5 wrong passwords in a row locks that login for 15
  minutes.** The person sees the same "didn't match" message either way,
  so the lockout does not reveal which emails have logins.
- **Password reset**: built in. Its reset tokens can be stored as
  fingerprints only (`storeIdentifier: "hashed"`), which we switch on.
  Resetting a password signs out every other session. It does not skip
  the authenticator: a reset gets you a new password, not a way round
  the second factor.
- **New-device email: NOT built in.** We add it: a long-lived cookie
  identifies each browser that has signed in. A sign-in from a browser
  without one (or with one not seen for this login) emails the User with
  the time (in the Operator's timezone) and the kind of device.

## Accepting an invite

1. The link opens `/invite/<secret>` on the Operator app. The page
   fingerprints the secret and looks the invite up.
2. Unusable invite (expired, cancelled, already used, or the Operator is
   suspended): a plain "this link no longer works, ask for a new one"
   page. Same page whatever the reason, so the link reveals nothing.
3. Usable: shows the business name and the User's email, and asks for a
   password twice.
4. On submit, in one transaction: mark the invite accepted **only if it
   is still unused, unexpired and not cancelled**, create the password,
   mark the email verified (the invite email proved it). Two tabs
   submitting at once cannot both succeed.
5. The person is signed in and taken straight to setting up their
   authenticator, then shown their recovery codes once.

The invite page sends no referrer, so the secret in its address is not
passed on to any other site.

Changed from the slice 3 plan: that plan suggested a database function
for looking invites up. Giving the lookup to `web_auth_role` does the
same job more simply: it is the login system's own role, already trusted
with every login, and `web_app_role` still cannot see invites at all.

## Signing in

- Email and password, then the 6-digit code (or a recovery code).
  "Remember this device for 14 days" checkbox on the code step.
- Refused, with the same message: wrong password, unknown email, locked
  login, archived User, suspended Operator. Each refusal is logged.
- Every page in the Operator app checks, on every request: signed in,
  authenticator set up, User not archived, Operator not suspended. That
  check is in server code, not in `proxy.ts` (rule 4). A suspended
  Operator's signed-in Users are stopped at their next click, not just
  at their next sign-in.
- The Operator is taken from the signed-in User's record, never from
  anything the browser sends (rule 1).
- After signing in: a placeholder page saying who is signed in. The real
  dashboard is slice 5.

## Password reset (4b)

"Forgot password" asks for an email and always answers "if that address
has a login, we've sent a link", whether or not it does. The link works
for 1 hour, once. The new password must be at least 12 characters. All
other sessions are signed out.

## Database changes

### `users` — columns added

`email_verified`, `image` (unused), `two_factor_enabled`, as for Admins.

### New, all under forced row-level security

| Table | What it holds | Has `operator_id` |
|---|---|---|
| `user_accounts` | The password hash, plus the wrong-password count and lockout time | Yes |
| `user_sessions` | Who is signed in where | Yes |
| `user_two_factors` | Authenticator secret and recovery codes (encrypted) | Yes |
| `user_verifications` | Password-reset tokens (fingerprints only) | No: transient |
| `user_known_devices` | Fingerprints of browsers that have signed in, for the new-device email | Yes |

Better Auth does not know about Operators, so it cannot fill in
`operator_id` itself. A database trigger fills it in from the User on
every insert, so these tables keep rule 1's `operator_id NOT NULL`.

### Permissions

- `web_auth_role`: the login tables above; reading Users, and changing
  only their verified / authenticator flags; looking up invites and
  marking one accepted; reading only an Operator's name, timezone and
  suspension; adding lines to the activity log and the test inbox.
  Nothing else.
- `web_app_role`: nothing on any login table. **Narrowed on `users`:**
  today it may change any column of a User, which would include the new
  authenticator flag. It becomes `full_name` only.
- `admin_app_role`: **narrowed on `users` the same way**, so the
  ordinary admin app cannot switch a User's second factor off.
  (Resetting a User's authenticator from admin is a later, deliberate
  feature.)

## Logged

To the Operator's activity log, actor User: invite accepted, signed in,
sign-in failed (only when the email matches a User), locked out,
authenticator set up, password reset. The admin Operator list gains a
"last sign-in" column from this. Never logged: passwords, codes, tokens.

## New settings for the Operator app (Vercel `fleetapp-web` project)

| Setting | What it is |
|---|---|
| `AUTH_DATABASE_URL` | Connection string for `web_auth_role` |
| `BETTER_AUTH_SECRET` | New random secret, different from admin's |
| `AUTH_ISSUER_NAME` | Name shown in the authenticator app |
| `EMAIL_TRANSPORT` | `dev_outbox`, as for admin |
| `EMAIL_FROM` | Sender name and address, as for admin |

## Tests

Database, against a real Postgres:

- `web_app_role` cannot read any login table, and cannot change a User's
  authenticator flag. Same for `admin_app_role` on that flag.
- `web_auth_role` cannot read the activity log, anything Admin, or any
  Operator column beyond the ones listed above.
- The trigger fills in `operator_id`, and a row cannot claim a different
  Operator from its User.
- Tenant isolation still holds for every new table.

Operator login (`apps/web`), against a real Postgres with the real
migrations:

- Accepting an invite sets a password and marks it used; using it again,
  after expiry, after cancellation, or for a suspended Operator fails.
- Two acceptances at once: exactly one succeeds.
- Sign-in works, then requires a real authenticator code; the trusted
  device cookie skips the code; an untrusted one does not.
- 5 wrong passwords lock the login; the right password is refused while
  locked and works after the lock ends.
- A suspended Operator's User cannot sign in, and an existing session
  stops working.
- (4b) A reset link sets a new password once, expires, and signs other
  sessions out; the database holds only the token's fingerprint.
- (4b) A sign-in from a new browser emails the User; from a known one,
  it does not.

## Found while planning

1. **The admin login has the same wrong-password gap.** Its only
   protection is the in-memory rate limit, so in practice password
   guesses are unlimited (the authenticator code still stops them
   getting in). Recommendation: the lockout code is shared, so apply it
   to Admins in this slice too.
2. **`AUTH_ISSUER_NAME` for Operators is effectively the product name**,
   shown in every Operator's authenticator app. Until the name is
   decided, use a placeholder on the dev site. Before the first real
   Operator, the real name has to be set.
3. **The authenticator setup screen is needed in both apps.** Rather than
   copy it, it moves into `packages/ui` as a shared component, with each
   app passing in its own login calls.

## Not in this slice

- Resetting a User's authenticator from admin (needs an out-of-band
  identity check process: later slice).
- More than one User per Operator.
- The dashboard and setup checklist: slice 5.
- Postmark: still the test inbox.
