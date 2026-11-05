# Review fixes, batch 3: logins and server safety (plan, awaiting approval)

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
