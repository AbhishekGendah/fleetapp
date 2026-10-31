# Before launch

Everything that must be done before the first real Operator goes live.
Nothing here is optional. Each item says why, and where the detail is.
Add to this list whenever something is relaxed or put off "until launch".

## Undo what was relaxed for testing

- [ ] **Admin sign-in time limits back on.** Relaxed on 30 Oct 2026 at
  Abhi's request so he is not signed out while testing: two weeks without
  use and 30 days at most, instead of the approved 30 minutes and 8 hours.
  To restore: in `packages/auth/src/login-policy.ts`, set `ADMIN_SESSION`
  back to `ADMIN_SESSION_AT_LAUNCH` (one line), and make sure the
  session-limit tests still say 8 hours.

## Full security review

- [ ] **A complete security review of both apps before launch**, by
  someone other than whoever built it, covering at least:
  - tenancy: every table, every query, row-level security, and the
    functions that cross Operators (`app.operators_with_file_housekeeping_due`,
    `app.vehicles_not_in_catalogue`, `app.correct_vehicle_make_model`,
    `app.renter_link_for_token`), and the Renter link pages and actions;
  - sign-in: time limits (above), lockouts, authenticator, recovery codes,
    password reset, remembered devices, session cookies;
  - the admin site: what it can read and change, and that it still cannot
    read Renter personal data (rule 5), including through the activity log
    once Renters exist (see progress.md);
  - files: buckets private, upload checks, link lifetimes, identity
    documents apart and every view logged;
  - secrets: all in Vercel/Bitwarden, none in code, `BETTER_AUTH_SECRET`
    backed up;
  - dependencies up to date with no known vulnerabilities;
  - logs: no personal data, tokens or licence details (rule 7).

## Settings and services for production

- [ ] Production buckets: the old-copies clean-up rule at 7 days, not 30
  (docs/legal-notes.md, Stored files).
- [ ] Google Places: a production project and key with higher caps, and an
  in-app daily limit per Operator (progress.md, Open items).
- [ ] Google logo image in place of the "Powered by Google" text, and the
  storage carve-out confirmed on Google's policy page (docs/legal-notes.md).
- [ ] Postmark set up; `EMAIL_TRANSPORT=dev_outbox` never set in
  production (the test inbox holds working links).
- [ ] Forgot-password replies take the same time for every address (send
  in the background once Postmark is in).
- [ ] Separate production database and buckets, with real Renter data only
  there (CLAUDE.md, Development environment).
- [ ] Switch from pushing to main to branches and pull requests (CLAUDE.md).
- [ ] Admin password reset built (progress.md, Open items).

## Legal

- [ ] Everything in docs/legal-notes.md reviewed by a lawyer: privacy
  policy, Operator terms (including AGS correcting car make and model
  names, and record keeping), the Renter privacy notice, and the data
  breach response plan.
- [ ] PintoFleet name checked (ASIC, IP Australia, domain).
- [ ] The privacy notice on the Renter's details form checked by the lawyer,
  and every Operator has a privacy policy it can point to (required by the
  Operator terms, or a template from AGS; a link to it on the form may be
  wanted). See docs/legal-notes.md, Renter links.
