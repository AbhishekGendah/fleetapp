# Phase 1a, slice 3 — Operators and invites

Status: planned, awaiting approval.

Goal: from the admin site, Abhi can create an Operator, which emails its
first User an invite link. He can list Operators, resend an invite, and
suspend or reactivate an Operator. Until Postmark is set up, emails land
in a test inbox inside the admin site instead of being sent.

Accepting the invite (choosing a password, setting up an authenticator)
is slice 4. The invite link will go to a page that does not exist yet.

## What Abhi will see

- **Operators** page: one card per Operator on a phone, a table on a
  wider screen. Shows the business name, the User's email, and a status:
  Invited, Invite expired, Active or Suspended. "Active" only becomes
  possible in slice 4, when Users can accept. Last sign-in and storage
  used are shown once they exist (slice 4 and Phase 1b).
- **New Operator** form: legal business name, trading name (optional),
  the User's full name and email. Everything else the Operator fills in
  through their setup checklist, as docs/design/01 says.
- **Operator detail** page: the details above, the invite's state and
  expiry, and buttons for Resend invite, Suspend and Reactivate. Also
  the Operator's history from the activity log.
- **Test inbox** (dev only): every email the system would have sent, and
  each one opened as it would look. Only appears when the test inbox is
  switched on.

## Decided in this plan (push back on any)

1. **The invite expires after 7 days.** A fixed AGS setting, not an
   Operator one: Operators never send invites in v1.
2. **The link carries a random secret; only a fingerprint of it is
   stored** (a SHA-256 hash, same idea as Renter links, rule 26). A leaked
   database backup cannot be turned into working invite links. The
   consequence is that an invite cannot be "re-sent" as the same link:
   Resend makes a new link and cancels the old one.
3. **The User record is created with the Operator, before the invite is
   accepted.** It has no password until slice 4. This means the email is
   reserved straight away, so the same address cannot be invited twice
   or to two Operators.
4. **Suspending an Operator stops its Users signing in and its Renter
   links working. It does not stop Renter payments.** The same reasoning
   as read_only in docs/design/01: that money is the Operator's, owed by
   their Renters. Stored as a `suspended_at` date, not a new status, so
   suspension stays separate from the AGS subscription status. Slice 3
   records it; slice 4 is where sign-in starts checking it. While
   suspended, invites cannot be resent.
5. **If the email fails to send, the Operator is still created.** Its
   invite shows "Not sent" and Resend is right there. The alternative,
   undoing the whole Operator because an email failed, makes a temporary
   email problem look like a data problem.

## Database changes

### `operators` — one column added

`suspended_at` (date and time, empty when not suspended). The Operator
app's database role cannot change it: its edit permissions are listed
column by column, and this column is not on the list.

### `operator_invites` — new, tenant-owned

`id`, `operator_id`, `user_id`, `token_hash`, `expires_at`, `sent_at`
(empty until the email has gone), `accepted_at`, `revoked_at`,
`created_by_admin_id`, `created_at`.

- Has `operator_id`, row-level security enabled and forced, like every
  tenant table. The structural test checks it automatically.
- Never deleted. A used or cancelled invite is a record of what happened.
- The admin app's role can create invites and change only `sent_at` and
  `revoked_at`. Marking one accepted belongs to slice 4's login system.
- The Operator app's role is granted nothing on it in this slice.

### `dev_email_outbox` — new, AGS-owned

The test inbox. `id`, `to_address`, `from_address`, `subject`, `html`,
`text`, `created_at`. Exempt from `operator_id` (it belongs to AGS, not
to an Operator) but still under forced row-level security.

- Both app roles can add emails to it (the Operator app will send emails
  from slice 4). Only the admin app's role can read it.
- Never filled in production: production will send through Postmark.

## How emails are sent

A new package, `packages/email`, so both apps send email the same way:

- One `sendEmail` interface, with two ways to send behind it: the test
  inbox now, Postmark later. Which one is used is a setting, so code
  never checks "am I in production?".
- Templates written with **React Email**, as CLAUDE.md already specifies.
  New dependencies: `@react-email/components` and `@react-email/render`,
  pinned to exact versions. Why: they turn one template into the HTML
  and plain-text versions email clients need, with layouts that survive
  Outlook and Gmail.
- The sender name is not hardcoded (no product name yet): it comes from
  a setting.

## New settings (environment variables)

All three in the admin app's `.env.example`, its startup checks and
`apps/admin/turbo.json`, in the same commit:

| Setting | What it is |
|---|---|
| `APP_URL` | The Operator app's address, to build the invite link |
| `EMAIL_TRANSPORT` | `dev_outbox` for now; `postmark` once it exists |
| `EMAIL_FROM` | Sender name and address, e.g. `Product Name <no-reply@…>` |

The admin app refuses to start if any is missing. The test inbox page
exists only when `EMAIL_TRANSPORT` is `dev_outbox`.

## Every admin action is logged

Into the existing `activity_log`, with the actor as the signed-in Admin:
Operator created, User created, invite sent, invite resent (the old
invite cancelled), Operator suspended, Operator reactivated. The invite
link itself is never logged, anywhere (rule 7).

Creating an Operator writes the Operator, its User, the invite and the
log lines in one transaction: either all of them exist, or none do.

## Tests

Database (`packages/db`), against a real Postgres:

- The Operator app's role cannot read invites or the test inbox.
- The Operator app's role cannot set `suspended_at`.
- Operator A's invites are invisible to Operator B (the tenant isolation
  test covers the new table automatically).
- Nobody can delete an invite.

Admin app (`apps/admin`), against a real Postgres with the real
migrations:

- Creating an Operator writes the Operator, User, invite and log lines,
  and an email lands in the test inbox with a working link.
- The database holds only the fingerprint of the link, never the link.
- Inviting an email that is already in use fails cleanly and leaves no
  half-created Operator behind.
- Resend cancels the old link and issues a new one.
- An expired invite shows as expired.
- Suspend and reactivate are recorded, and resend is refused while
  suspended.
- An email failure leaves the Operator in place with the invite "Not
  sent".

## Found while planning

1. CORRECTED: the root `turbo.json` lists no environment variables, but
   that is fine: each app and package lists its own in its own
   `turbo.json`. The new settings go in `apps/admin/turbo.json`.
2. **Slice 4 needs one careful piece:** when someone opens an invite
   link there is no signed-in Operator yet, so no tenant to scope the
   lookup by. The plan for slice 4 is a narrow database function that
   takes a fingerprint and returns only which invite it belongs to,
   rather than giving the Operator app's role open read access to
   invites. Recorded here so it is not improvised later.
3. **In dev, the test inbox will later hold emails to Renters too**
   (fake ones: real Renter data never exists outside production). That
   is fine for testing, but it is one more reason the inbox must never be
   switched on in production.

## Not in this slice

- Accepting an invite, Operator sign-in, password reset: slice 4.
- Admin password reset (deferred from slice 2): it can now use the test
  inbox, but is left for its own small change rather than widening this
  one.
- Resetting a User's authenticator from admin: needs Users to have one
  first (slice 4 onward).
- Postmark itself: needs Abhi to set up the account and sending domain.
