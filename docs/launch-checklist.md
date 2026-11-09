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
- [ ] **Simultaneous-action leftovers from the business Renters reviews**
      (decided with Abhi 9 Nov 2026: from slice 4 on, only clashes that
      lose, duplicate or wrongly change money or data were fixed at once;
      the rest wait for the pre-launch whole-app review). None loses data;
      each at worst shows one person an error or slightly stale wording:
  - a payments link's greeting name is read before the Renter is locked;
  - `sendPaymentsLink` reads the rental without locking it;
  - the FOR UPDATE lint rule misses `sql.raw(...)` and a `.for()` argument
    held in a variable;
  - a phone's queued photo refused because its checklist was signed on
    another phone is dropped without a note on that phone;
  - a direct database write within one Operator could point a copied
    damage mark at another of its own marks (no database check);
  - a refund made in the business's own Stripe dashboard on a charge that
    isn't ours, while one of its bond pages awaits a payment, retries for
    up to 3 days and logs alerts (noise only);
  - a business trading under exactly its contact's own name can't sign
    (the signer-is-the-business check);
  - anything further the whole-app review finds of this kind (the lock
    order and lock modes are in docs/plans/business-renters.md).

## Settings and services for production

- [ ] Measure Home and Needs attention with a realistic history (hundreds of
      rentals, years of ledger lines): Overdue reads every non-cancelled
      rental's ledger lines on each load (look slice 2, 7 Nov 2026). If slow,
      let the database leave out rentals whose lines sum to zero (still worked
      out from the ledger, rule 11).
- [ ] Production Vercel projects have `APP_STAGE=production` for every
      environment (Production and Preview). Branch previews on the dev
      projects accept sign-ins from their own *.vercel.app address (added
      7 Nov 2026 so Abhi can try previews); with `production` nothing beyond
      APP_URL/ADMIN_URL is ever trusted (tested in apps/web/test/preview-origins.test.ts).
- [ ] Stripe in live mode: the AGS platform account verified, Connect's
      platform profile filled in, live keys in the production Vercel project
      only (PAYMENTS_TRANSPORT=stripe), and the live event destination's
      secret. Never the stand-in (the app refuses it in production).
      Consider a restricted live key with only what the app uses (accounts,
      account links, and later payments) instead of the full secret key.
- [ ] Stripe Connect branding for live mode: the product's name, icon and colour
      (Settings → Connect → Branding), so businesses see it on Stripe's
      onboarding pages instead of the sandbox's name.
- [ ] Roll the Stripe sandbox secret key (Developers → API keys → Roll key) and
      update Vercel and Bitwarden: it was shown in a chat screenshot on
      3 Nov 2026. Sandbox only, so left for now by Abhi's choice.
- [ ] The live event destination for connected accounts (v1 Checkout and
      mandate events, thin) and its secret (STRIPE_CONNECT_WEBHOOK_SECRET) in
      the production Vercel project; without it Renters are not offered
      Stripe's page. It also needs the events added in review fixes batch 2:
      v1.checkout.session.expired, v1.refund.created, v1.refund.updated,
      v1.refund.failed, v1.charge.dispute.funds_withdrawn,
      v1.charge.dispute.funds_reinstated and v1.account.application.deauthorized;
      the platform destination needs v2.core.account.closed.
- [ ] The four database logins on the live Neon database made with
      docs/runbooks/database-roles.md (never Neon's "Add role" screen). The
      apps refuse to start if a login could bypass row-level security.
- [ ] `APP_STAGE=production` in the production Vercel project. The app now
      refuses to start with a live Stripe key unless it is set, and refuses a
      test key when it is (review A5-9).
- [ ] Before slice 5 goes live, in Stripe's sandbox (they couldn't be tried
      from the cloud session, which can't reach Stripe): that refund and
      dispute events arrive as thin events from the connected-accounts
      destination; which event a business disconnecting sends with Accounts
      v2; and that detaching a replaced direct debit's bank account sends
      "mandate updated" with it inactive (docs/plans/review-fixes-batch-2.md).
- [ ] A Renter's bond refunded by hand (cash or transfer) can't be recorded
      yet: refunds come with Phase 4 slice 7. Until then a cancelled booking
      still holding a cash bond shows "Bond to refund" and stays on the
      dashboard.
- [ ] Stripe's answer on paper Direct Debit Requests entered by the business
      (docs/legal-notes.md, Renter direct debit) read, and the app changed
      only if Stripe allows it and the lawyer agrees.
- [ ] Drop the four unused Stripe columns on the operators table (from
      Phase 1; replaced by stripe_accounts in Phase 4 slice 3) in a
      migration after the code that stopped reading them is deployed.
- [ ] No rolling the code back past business Renters slice 3 once a
      Business rental contract template exists: older code doesn't know the
      `business_contract` template kind, so its Contracts settings and
      sending would meet a kind it can't read. If a roll-back is ever
      needed, archive those templates first (or roll forward instead).

- [ ] The nightly rent run then issues every business's invoices one at a
      time, inside one 300-second call. Before many businesses are on the
      platform, measure how long it takes and split it (e.g. one call per
      business through a queue) well before it gets near the limit.

- [ ] Production buckets: the old-copies clean-up rule at 7 days, not 30
      (docs/legal-notes.md, Stored files). Uploads first land under `incoming/`
      and are moved once checked: the app's storage login needs read, write,
      copy and delete there too, and a bucket rule removing `incoming/` objects
      older than 2 days is a cheap backstop (review A7-6: set it on dev too,
      batch 7).
- [ ] Production buckets: the app's storage login may copy an object onto
      itself with storage class GLACIER_IR (the nightly move of year-old
      checklist photos, batch 7). Check the first night's run on dev
      (`longTerm` in the clean-up's answer) once dev has a year-old rental.
- [ ] Browser tests still to add (batch 7, review A10-9): the Renter's
      submitted-details review, the insurance policy page, the damage page on
      its own, the admin business page's Suspend and Reactivate, and the
      Renter's details form filled in and sent at phone width, and the
      "Account paused" page checked for accessibility by a test login whose
      business is paused.
- [ ] Link codes (batch 7 review): once Postmark is in, tell an address it
      refused (bounced or blocked) apart from "we don't know", so the Renter
      can be told to ask for a new link rather than to try again; and give
      failed sends their own limit, since a failed send now hands its code
      back and does not count toward the 3 an hour.
- [ ] Removed insurance-policy papers (not on a car's record) can't yet be
      brought back from a screen: they are kept 5 years, recoverable only
      by AGS. Add a Bring back on the policy page (batch 7, left for later).
- [ ] Email templates off `@react-email/components` (packages/email): npm
      marks it no longer supported (last release 1.0.12, Apr 2026). Its
      makers moved everything into one `react-email` package in 6.0.0
      (MIT, released weekly); the change is the import path, the components
      and `render` stay the same. Pin the newest release at least 14 days
      old (6.11.3 on 5 Nov 2026; 6.11.6 from 12 Nov), swap the imports in
      the 15 template files, compare the rendered emails, and check the
      server bundle size (the package also carries its preview tool).
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
- [ ] The production database set up with docs/runbooks/production-database.md:
      its own Neon project in Sydney, the four logins, the owner address in
      GitHub's secrets only, Abhi's Neon account on two-step sign-in.
- [ ] Production's point-in-time restore window set to at least 7 days, and
      one test restore onto a throwaway branch done before launch (then every
      three months; runbook).
- [ ] A production "Migrate and deploy" job using a GitHub Environment
      `production` (its own owner address, Vercel project IDs, and Abhi's
      approval before it runs); today's job serves dev only (runbook).
- [ ] Apps put live only by GitHub's "Migrate and deploy" job: Vercel token
      in GitHub's secrets, project IDs in its variables, and Vercel's own
      deploys from `main` turned off in each app's vercel.json (batch 6).
- [ ] Switch from pushing to main to branches and pull requests (CLAUDE.md).
- [ ] Admin password reset built (progress.md, Open items).
- [ ] `OPS_ALERT_EMAIL` set in the production Vercel project to an AGS inbox
      someone reads (the nightly run's failure alert). Required: the app will
      not start without it.
- [ ] An alert on the production web app's logs for "A Stripe refund or
      dispute is waiting for its bond payment to be recorded", sent to the
      same AGS inbox. Such a refund or dispute is never taken as handled
      while a bond payment of the business could still be recorded; past
      Stripe's three days of resending, AGS resends the event from the
      business's Stripe dashboard once the payment is in. The log line holds
      Stripe's and the app's ids only. There is no Operator-facing notice of
      it yet (no record to hang one on without a new table).

## Documents

- [ ] The lawyer confirms 7 years: a Renter's personal details, signed PDFs
      and photos are removed 7 years after their last rental ended, money
      lines kept as amounts (decided by Abhi 5 Nov 2026, built in batch 5;
      the nightly job is live from then). Also the two known limits: payment
      references typed into money lines stay, and the Renter's record on the
      business's own Stripe account is the business's to delete. See
      docs/legal-notes.md, Review fixes batch 5.
- [x] Every European name prints in PDFs: Noto Sans embedded (SIL OFL,
      allowed for fonts by Abhi 5 Nov 2026, batch 4). Scripts beyond Latin,
      Greek and Cyrillic (e.g. Arabic, Chinese) would still need another font.

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

- [ ] **Business Renters' privacy wording** (docs/plans/business-renters.md,
      Legal): the Renter privacy notice says that a driver's name, signature
      and the car's use are shared with the business they drive for (wording
      added 8 Nov 2026, slice 2: emailed to each new driver and shown on
      their details link); the lawyer checks it, and the PPS lease question
      (long hires to a company), before the first business Renter is added
      on a live site.
- [ ] **A driver with only a phone gets no details link** (business Renters
      slice 2): links and their codes go by email until the SMS provider is
      chosen. The Drivers tab tells the Operator to add the driver's email.
- [ ] **A driver with no email gets no copy of the papers they sign**
      (business Renters, driver copies, 8 Nov 2026): the copy goes by email
      only until the SMS provider is chosen; the rental page says "Not
      emailed to the driver: no email on file", and the Operator can
      download the report for them.
- [ ] **Signing for a business** (slice 3): the lawyer checks the
      authorised-signer wording ("I am authorised to sign for …", name and
      position) for companies (Corporations Act s 127, agents), and the
      Operator's Business rental contract terms (unfair contract terms for
      small businesses, other drivers, naming drivers on fines).

- [ ] Everything in docs/legal-notes.md reviewed by a lawyer: privacy
      policy, Operator terms (including AGS correcting car make and model
      names, and record keeping), the Renter privacy notice, and the data
      breach response plan.
- [x] "Download everything we hold" for a Renter includes their damage
      records and insurance claims, and everything else held, with the
      documents themselves (batch 5, 5 Nov 2026).
- [ ] PintoFleet name checked (ASIC, IP Australia, domain).
- [ ] The Renter privacy notice wording checked by the lawyer: one wording,
      on the details, signing and payments links, emailed to Renters added at
      the counter, and a short line on the business's phone (batch 5). Each
      business can now give its privacy policy link in Business details.
- [ ] The Operator privacy policy template
      (docs/legal/renter-privacy-policy-template.md) reviewed once by the lawyer,
      and the Operator terms saying it is a
      starting point the Operator is responsible for.
- [ ] Operator terms say the Operator sets, and is responsible for, the
      minimum Renter age and whether provisional licences may rent, and the
      lawyer confirms the age discrimination exemption covers it. See
      docs/legal-notes.md, Bookings.
- [ ] The Business rental contract starter (and the lawyer's check of it)
      says a driver change is asked for through the Operator, needs the car
      brought in, and that the business stays responsible for the car and
      its fines until the new driver signs for it (business Renters slice 4,
      docs/legal-notes.md).
