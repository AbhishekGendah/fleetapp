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

- [ ] **Demo data tool off on the live site.** Settings → Demo data
      (added 2 Nov 2026 for testing) fills a business with made-up records. It
      refuses to run unless APP_STAGE is not production and email goes to the
      test inbox, and the live site has neither. Before launch, check on the
      live site that Settings shows no Demo data card and
      /settings/demo-data says page not found; consider removing the tool
      (`apps/web/src/lib/demo-data`, `apps/web/src/app/settings/demo-data`).

## Full security review

- [ ] **A complete security review of both apps before launch**, by
      someone other than whoever built it, covering at least:
  - tenancy: every table, every query, row-level security, and the
    functions that cross Operators (`app.operators_with_file_housekeeping_due`,
    `app.vehicles_not_in_catalogue`, `app.correct_vehicle_make_model`,
    `app.renter_link_for_token`, `app.operators_with_abandoned_renter_submissions`,
    `app.delete_abandoned_renter_submissions`, `app.operators_with_licence_scans_added_before`),
    and the Renter link pages and actions;
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

- [ ] The nightly rent run then issues every business's invoices one at a
      time, inside one 300-second call. Before many businesses are on the
      platform, measure how long it takes and split it (e.g. one call per
      business through a queue) well before it gets near the limit.

- [ ] Production buckets: the old-copies clean-up rule at 7 days, not 30
      (docs/legal-notes.md, Stored files). Uploads first land under `incoming/`
      and are moved once checked: the app's storage login needs read, write,
      copy and delete there too, and a bucket rule removing `incoming/` objects
      older than 2 days is a cheap backstop.
- [ ] Google Places: a production project and key with higher caps, and an
      in-app daily limit per Operator (progress.md, Open items).
- [ ] Google logo image in place of the "Powered by Google" text, and the
      storage carve-out confirmed on Google's policy page (docs/legal-notes.md).
- [ ] Postmark set up; `EMAIL_TRANSPORT=dev_outbox` never set in
      production (the test inbox holds working links). Set `APP_STAGE=production`
      in both production Vercel projects: the apps then refuse to start on the
      test inbox.
- [ ] Sign-in rate limit shared by all servers (Better Auth `rateLimit`
      storage "database": a small table and login-role grants, plan first).
      Today each server counts on its own; the password and code lockouts
      already hold in the database, so this is a second layer (review C6).
- [ ] Link the generated third-party licences file
      (/third-party-licences.txt, built with each app) from the terms or
      privacy page (docs/legal-notes.md, Libraries used).
- [ ] Renovate pull requests are being reviewed weekly (Renovate installed
      1 Nov 2026, "Renovate only", scan and alert; its Dependency Dashboard is
      issue #3 on GitHub).
- [ ] Browser tests run on Ubuntu 24.04 in CI because Playwright 1.56 does
      not support 26.04: move to ubuntu-latest when Playwright is upgraded
      (with the browser it needs; Renovate groups these).
- [ ] Forgot-password replies take the same time for every address (send
      in the background once Postmark is in).
- [ ] Separate production database and buckets, with real Renter data only
      there (CLAUDE.md, Development environment).
- [ ] Switch from pushing to main to branches and pull requests (CLAUDE.md).
- [ ] Admin password reset built (progress.md, Open items).

## Documents

- [ ] Retention period for issued documents (contracts, reports) decided
      with the lawyer (commonly 7 years) before any deletion rule touches
      them. See docs/legal-notes.md, Contract templates.
- [ ] If Renters' names may be in non-Latin scripts: embed a font in PDFs
      (built-in Helvetica covers English and Western European accents only;
      a font licence, usually SIL OFL, needs Abhi's say-so under rule 32).

## Domain and releases

- [ ] pintofleet.com.au (and pintofleet.au) bought; app., admin. (and
      staging. / staging-admin. if used) pointed at Vercel; APP_URL, ADMIN_URL
      and EMAIL_FROM updated; Postmark sending records added; Google Places key
      and Stripe updated for the new addresses. The altus addresses redirected
      or retired. See docs/roadmap.md, Phase 9.
- [ ] Branches + pull requests: `main` protected (checks must pass, Abhi
      approves), previews password-protected on dev data, production updated
      only from an approved build.

## Legal

- [ ] Everything in docs/legal-notes.md reviewed by a lawyer: privacy
      policy, Operator terms (including AGS correcting car make and model
      names, and record keeping), the Renter privacy notice, and the data
      breach response plan.
- [ ] "Download everything we hold" for a Renter includes their damage
      records and insurance claims (added 2 Nov 2026 with slice 6b; see
      docs/legal-notes.md).
- [ ] PintoFleet name checked (ASIC, IP Australia, domain).
- [ ] The privacy notice on the Renter's details form checked by the lawyer,
      and every Operator has a privacy policy it can point to (a link to it on
      the form may be wanted). See docs/legal-notes.md, Renter links.
- [ ] The Operator privacy policy template
      (docs/legal/renter-privacy-policy-template.md) reviewed once by the lawyer,
      and the Operator terms saying it is a
      starting point the Operator is responsible for.
- [ ] Operator terms say the Operator sets, and is responsible for, the
      minimum Renter age and whether provisional licences may rent, and the
      lawyer confirms the age discrimination exemption covers it. See
      docs/legal-notes.md, Bookings.
