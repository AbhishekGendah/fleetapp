# Review fixes, batch 3: logins and server safety (approved 5 Nov 2026, built)

From docs/reviews/2026-11-04-full-code-review.md, fix order item 3: before
the first real business. Touches logins and the database logins, so
nothing is built until this is approved. Both apps (business app and AGS
admin) share the login setup in packages/auth, so most fixes are made once
there and used by both (also fixing A2-12, the copied login code).

## Logins

### 1. Authenticator and password changes leave no trace (A2-1, A9-2, serious)

Today every one of these needs the account's password, but a browser that
saved the password fills it in. Nothing is recorded, nobody is told, and
the app has no screen that needs most of them.

Fix:
- **Switch off what the app never uses.** These are refused for both apps:
  - turning the authenticator off (it is mandatory, CLAUDE.md);
  - showing the authenticator's set-up code again once it is set up;
  - changing the password while signed in (a password is changed only
    through the "Forgot password" email, which proves the inbox).
- **Recovery codes made again** stay allowed, but need a fresh authenticator
  code as well as the password.
- **Every change that stays allowed is logged and emailed** to the account
  holder, with "If this wasn't you, reset your password and contact us":
  - the authenticator set up;
  - recovery codes made again;
  - the password reset.

### 2. Sign-in history is wrong (A2-5, A9-1)

Fix:
- **"Signed in" is recorded once, and only after the authenticator code**,
  not when the password matches. "Last signed in" on the admin Operators
  list follows.
- **Also recorded:** a wrong authenticator or recovery code, and the
  15-minute lock after five of them.

### 3. Anyone can lock a login with broken requests, with no trace (A2-6)

Fix:
- **Only a real wrong password counts** towards the five tries. A broken
  request is refused before it counts.
- **A lock is always recorded**, however it happened.

### 4. Login and page errors put personal details in the hosting logs (A2-2, A7-1, privacy)

Fix:
- **The login system's own error logging** goes through the app's safe
  logger (error type and code only, never the message or the query's
  values), in both apps.
- **Errors Next.js logs itself** (a page or button that fails) go through a
  Next.js `instrumentation.ts` hook that logs only the same safe details.

### 5. Authenticator codes can be reused for about 90 seconds (A2-7)

Fix: each account remembers the last code step it accepted; the same or an
older code is refused. Kept in a new column on the 2FA record.

### 6. "Remember this device for 14 days" never runs out (A2-9)

Fix: a remembered device lasts 14 days from when the code was last typed,
not from each sign-in. Once that runs out, the code is asked for again.
Built on Better Auth's trust-device record: its expiry is not renewed when
it is used.

### 7. A switched-off AGS staff account can still sign in (A9-5)

Fix: an archived staff account can't sign in or use any login action
(the same check the business app has). The sign-in screen says "This
account has been switched off. Ask AGS." instead of looping.

### 8. "Forgot password" can flood an inbox (G6-1)

Fix: at most 3 reset emails per login email an hour, and 20 per IP an hour,
counted in the database (so every server sees the same count). Past that,
the page still says "If the email is registered, we've sent a link" (never
revealing which emails exist), but nothing is sent.

### 9. The smaller login items

- **Forgot password before accepting the invite (A2-3):** the reset marks
  the invite accepted (the owner proved their inbox), so the invite link
  then says "Already set up: sign in" instead of crashing.
- **The monthly sign-out (A2-4):** shows "For your security, please sign in
  again", never an error page; anything being saved says the same.
- **Database hiccup during a password reset (A2-10):** other browsers are
  signed out first; a hiccup after the new password is saved still signs
  them out, and the screen says the password was changed.
- **Invite email status (A9-8):** shown from the email's own record, not
  guessed.
- **Sign-in screens stuck on "Signing in…" (A10-6):** a dropped connection
  shows "Couldn't reach us. Check your signal and try again"; too many tries
  shows the lock message, not "password did not match".

## A suspended business (A9-4, A2-8): Abhi's decision

Today a suspended business's Renters are still invoiced but can't pay
online, and its owner is told their password is wrong.

**Recommendation:**
- Renters keep paying online: their bond and direct debit go to the
  business's own Stripe, and blocking them hurts the Renter, not the
  business.
- The owner, signing in, sees "Your account is paused. Contact AGS" (no
  login lock, no password confusion).
- The Suspend confirmation says exactly that.

Tradeoff: a suspended business still takes Renters' money through the app,
but AGS's lever is the subscription, not the Renters.

## Database logins

### 10. The admin site's database login can do too much (A9-3, A1-4)

Fix (migration 0044):
- **Narrowed to the columns admin screens actually change**: operators'
  name, suspension and contact columns only. No GST status, timezone or
  Stripe columns.
- **AGS staff accounts** are made only through a narrow function that also
  logs it, never by a plain insert.
- **Log lines:** admin can add only its own log lines, as itself.
- **Business settings:** admin reads them without the "How to pay" bank
  details (a view that leaves them out, as rule 5 and the privacy notes
  say).

### 11. The four database logins were made by hand, with no check (G1-4)

Fix:
- A written recipe (docs/runbooks/database-roles.md) with the exact SQL to
  run in Neon's SQL editor. Never Neon's "add role" screen, which gives the
  role BYPASSRLS.
- A check at every deploy: each app on start-up confirms its own login
  can't bypass row-level security and isn't the owner, and refuses to start
  if it can.

## Server safety

### 12. A doctored signature, logo or template can crash the server (G5-1, G5-2, G5-3)

Fix:
- **Signatures and logos:** read the picture's width and height from its
  header before anything is drawn, and refuse anything over sensible sizes
  (signature 2000×800 px; logo 2000×2000 px).
- **Logos:** re-made on the server into a small PNG when uploaded, so a
  stored logo is always one the app made.
- **Contract templates:** at most 20 levels of nested lists, checked
  before the full check runs, with the clear "too complex" message.

## Email in production (A9-7)

Fix: the admin test inbox (and the business app's) is refused unless
`APP_STAGE=development` is set outright, the same way the Stripe stand-in
now is. A missing setting on the live site fails at start-up instead of
sending real Renter emails to AGS.

## What Abhi does

- One-time, before launch: run the database roles recipe (item 11) on the
  live Neon database, one step at a time with me. Nothing needed for the
  dev site unless the start-up check finds a problem.
- The dev site's Vercel projects need `APP_STAGE=development` for the test
  inbox to keep working (item 12b). I'll walk you through it.

## Tests

- Server:
  - each refused login action;
  - each logged and emailed change;
  - one sign-in recorded once, after the code;
  - wrong codes and the lock recorded;
  - a broken request not counting;
  - a code refused the second time;
  - the remembered device running out;
  - an archived staff account refused;
  - the reset limits;
  - invite and reset;
  - a reset surviving a hiccup;
  - the suspended owner's message.
- Database: the admin login refused on each narrowed column and table; the
  staff function; the settings view hiding "How to pay"; the start-up role
  check.
- PDFs: an oversized signature or logo refused; a deep template refused
  with the right message.
- Logs: a forced database error during sign-in and a page load logs no
  email, name or code.
- Browser: sign-in screens (lost connection, lock message, suspended,
  switched-off), with accessibility checks and phone width.

## Senior review of this plan

- **Security:** refusing unused login actions narrows what a stolen
  session can do. Logging plus emailing what's left means a takeover is
  seen. A per-email reset limit stops flooding without saying which emails
  exist.
- **Tenancy:** narrowing the admin login only removes rights; each admin
  screen is tested against it. The start-up check makes the hand-made
  roles verifiable.
- **Privacy:** no personal data in logs (rule 7); admin can't read "How to
  pay" (rule 5).
- **Legal:** record keeping (sign-ins and changes logged), APP 11
  (security of personal information), the email service's terms (no
  flooding).
- **Not in this batch:** signing and documents (batch 4), privacy and
  records (batch 5).

## As built (5 Nov 2026)

- **Suspension:** Abhi chose the recommendation (5 Nov 2026). A paused
  business's payments links keep working (renter_link_for_token, 0044);
  its owner sees "Your account is paused" at sign-in; the Suspend
  confirmation says so.
- **Login actions:** every action the apps don't use is refused, by an
  allow-list in packages/auth (loginGuard), not a block-list, so a new
  Better Auth action is refused until it is needed. That includes making
  new recovery codes (no screen offers it), not "allowed with a fresh
  code" as planned: refusing is simpler and safer.
- **Emails:** a password reset emails the owner. No email when the
  authenticator is set up: it can be set up only once (turning it off is
  refused), at the first sign-in after the invite.
- **Code reuse:** the same code is refused within its 90 seconds. An
  older code is not tracked separately; it would be outside its own
  window anyway within 30 seconds.
- **Reset emails:** 3 per login an hour, counted in the database. The
  per-IP limit stays Better Auth's own (3 a minute per server); a
  per-inbox limit is what stops the flooding.
- **Admin database login:** a new business can still be inserted
  table-wide (Drizzle names every column when it inserts), so a trigger
  refuses anything beyond its name. Updates are narrowed to pausing.
  Settings can't be read at all (no admin screen reads them), rather than
  through a view.
- **Logos:** checked by their header's size whenever a PDF is made, not
  re-made on upload (no image library on the server for that); the size
  check stops the freeze.
- **Deep review (5 Nov 2026), six findings, both checkers agreed, all fixed:**
  - A sign-in on a remembered device (no code) wasn't recorded. The login
    guard is now two plugins: the guard (listed first, refuses unused
    actions) and the sign-in recorder (listed after the authenticator
    plugin, so it can tell a finished sign-in from "now the code").
  - "Remember this device" running out deleted every login record with
    the User's ID, so a password step could cancel a reset link or a
    half-done sign-in. It now runs only after a right password and
    deletes only remembered devices (records that outlive a reset link).
  - The lock message never showed (its status was read before its code);
    the lock was logged late or more than once; a code step left over 10
    minutes said "code not right" forever. The code is read first, the
    lock is logged once as it is set, and an expired step goes back to the
    password with "That sign-in ran out of time".
  - Two devices could use one code at the same moment, and requests could
    mix each other's state. A code is now claimed in one database
    statement; the loser's sign-in is undone. No shared state.
  - Reset emails sent all at once could beat the limit. Counted under a
    lock per login now.
  - A picture cut off part-way crashed the page; now refused like any
    unreadable picture.
- **Not done here:** the handover return browser test ("takes the car
  back beside the handover") failed earlier on this date with and without
  this batch, and passed in the full run after the review fixes: it fails
  only sometimes. To be looked at on its own.
