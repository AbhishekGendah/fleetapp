# Project Rulebook

@docs/coding-standards.md

The AGS coding standards (imported above) apply everywhere. The rules
below are project-specific. If a request conflicts with anything here,
STOP and ask. Never work around a rule.

## What this is
Multi-tenant SaaS for Australian vehicle rental businesses (weekly and
ongoing rentals, often rideshare). Built by Altus Global Solutions
(AGS). Australia only. The product name is PintoFleet. It lives only
in the brand file in packages/ui (`packages/ui/src/brand.ts`, along with
the logo and colours); never type it anywhere else, so a rename stays a
one-file change. Settings that carry it (AUTH_ISSUER_NAME, EMAIL_FROM)
stay env vars. Never hardcode a domain or URL path: base URLs come from
env vars (APP_URL, ADMIN_URL).

## Terminology (use exactly, in code and UI)
- Operator: the business that subscribes (the tenant). Key: operatorId.
- User: an Operator's login. One per Operator in v1, but a separate
  table so more Users per Operator can be added later.
- Renter: the Operator's customer. Renters never log in; they use
  tokenised links only.
- Admin: AGS platform staff. Separate table, separate app.
- Driver: a person Renter named to drive a business Renter's car.

Never use "client", "customer" or "tenant" for these in code.

## Stack
- Monorepo: pnpm + Turborepo
  - apps/web: Operator app + renter link pages
  - apps/admin: AGS admin area (separate subdomain)
  - packages/db: Drizzle schema, migrations, DB client
  - packages/core: pure domain logic (money, dates, ledger, matching)
  - packages/ui: shared components
  - packages/config: shared tsconfig / eslint
  - packages/e2e: shared browser-test toolkit (runners, stand-ins,
    accessibility and download-size checks)
- Next.js latest stable, App Router, TypeScript strict. Next 16+ uses
  proxy.ts instead of middleware.ts.
- PostgreSQL on Neon, Sydney region. Separate dev and production
  databases.
- Drizzle ORM, pinned to the stable release.
- Better Auth: separate instances for web and admin. TOTP 2FA mandatory.
- Zod at every boundary (routes, actions, forms, webhooks, env, imports).
- Stripe: Connect (Accounts v2) with each Operator on the full Stripe
  dashboard, direct charges on the Operator's connected account (the
  Operator is the merchant; approved 3 Nov 2026, docs/plans/phase-4.md
  decision 1). BECS direct debit now, PayTo later. AGS subscriptions via
  Stripe Billing on the AGS platform account.
- Files: storage interface over AWS S3 ap-southeast-2. Separate dev and
  production buckets.
- Email: interface. Postmark (test mode outside production). React Email
  templates.
- SMS: interface. Provider TBD.
- Hosting: Vercel, functions pinned to syd1. apps/web and apps/admin are
  separate Vercel projects.
- Tests: Vitest (unit and database), Playwright (browser), axe-core
  (accessibility). Browser tests run each app against throwaway stores:
  Postgres, LocalStack for S3, a Google Places stand-in.
- Shared pieces are built on established libraries (docs/plans/library-swap.md):
  Base UI, React Hook Form, TanStack Table, nuqs, react-number-format,
  date-fns, libphonenumber-js and others. Use them; never rebuild what
  they do.

## Development environment
- Development happens in Claude Code on the web. No local machine is
  assumed.
- For now, commit and push directly to main. Switch to branches + PRs
  before the first real Operator goes live.
- Preview deployments are password-protected and use the dev database
  with fake data only. Real Renter data never exists outside production.
- Tests may run Postgres in Docker inside the cloud session.

## Tenancy and security (non-negotiable)
1. Every tenant-owned table has operator_id NOT NULL. Every query is
   scoped by the operatorId from the authenticated session, never from
   request input.
2. Postgres RLS is enabled AND forced on every tenant table as a second
   layer. The app connects as a non-owner role without BYPASSRLS.
   Tenant context is set per transaction with SET LOCAL.
3. Webhooks and background jobs have no session. Resolve the Operator
   from trusted data (e.g. Stripe event.account -> Operator) and set
   tenant context explicitly, one Operator at a time.
4. Authorisation happens in server code (route handlers, server
   actions, data layer). proxy.ts is routing only, never a security
   boundary.
5. apps/admin uses its own DB credentials and auth. Admin cannot read
   Renter personal data in v1.
6. Secrets only in env vars, validated with Zod at startup. Fail fast
   if missing. Stripe secret key never in client code or NEXT_PUBLIC_.
7. Never log personal data, tokens, licence details or bank details.
   Never store a Renter's bank or card details; Stripe holds them. The
   one exception is the Operator's own payment details that they type
   into "How to pay" to print on their invoices (approved 3 Nov 2026).
8. Identity documents (licence scans etc.) live in a separate private
   storage location, are served only via short-lived signed URLs, and
   every view is written to the activity log.

## Data rules (non-negotiable)
9.  Money is integer cents (AUD), never floats. Each ledger line stores
    its GST amount explicitly. GST treatment is set per charge type.
10. Timestamps are stored as UTC timestamptz and displayed in the
    Operator's timezone. Fine offence times are entered in the local
    time of the offence location and converted.
11. The ledger is append-only. Never update or delete ledger lines.
    Corrections are reversing entries. Balances are always calculated
    from the ledger, never stored as the source of truth.
12. Issued documents (signed contracts, handover/return reports,
    invoices, statements) are immutable. Store the PDF plus a SHA-256
    hash. Changes = new version or credit note.
13. Core records are archived, never hard-deleted. The only hard
    deletes are scheduled retention jobs.
14. A rental snapshots the Operator's settings when created. Settings
    changes affect new rentals only. Changing an active rental's terms
    is an explicit, logged change.
15. Possession: fine matching uses possession records. Possession
    starts at the signed handover acceptance by the Renter or, for a
    business Renter, by its named driver, and ends at the recorded
    return. A car swap or a driver change closes one record and opens
    another.
16. Payment method is a generic type field (becs_debit now, payto
    later). No BECS-specific columns in core tables.
17. Invoice numbers are sequential per Operator, with no gaps.
18. Double-booking is prevented at database level (exclusion constraint
    on vehicle + time range; ongoing rentals are open-ended ranges).
19. Every create/update/delete writes to the activity log with actor
    type: user, admin, system or renter_link.
20. Idempotency: webhook handlers record processed Stripe event IDs and
    ignore repeats. Scheduled jobs are safe to re-run: a unique
    constraint prevents charging a rental twice for the same period.

## Files and storage
21. Photos are resized on the device before upload (about 1600px long
    edge, about 400 KB) plus a thumbnail. Each file is stored once;
    PDFs embed small copies.
22. Uploads: images and PDFs only, with a per-file size cap. Validate
    file type server-side from content, not just the extension.
23. Lifecycle: photos from rentals closed over 1 year move to S3 Glacier
    Instant Retrieval. Deleted files are recoverable for 30 days, then
    purged. Abandoned uploads are cleaned up. Storage used is tracked
    per Operator.

## Product rules
24. Mobile-first: design at about 375px wide first. Tables collapse to
    cards on mobile. Touch targets at least 44px.
25. The handover/return checklist must survive poor signal: save
    progress on the device and queue photo uploads.
26. Renter links are single-purpose, expiring and revocable. Store only
    a hash of each token. They require a one-time code on a new device
    and never expose identity documents.
27. Operator settings have sensible defaults and are all editable.
28. Forms: every required field shows a red asterisk (`isRequired` on
    `FormField`/`Label` from packages/ui) and its box carries `required`
    or `aria-required`. A form with an asterisk shows `RequiredFieldsNote`
    at the top. Optional fields are not labelled "(optional)". Fields are
    checked as they are typed with the same Zod schema the server uses.
29. Screens use the shared pieces in packages/ui (Button, Input, Select,
    FormField, Checkbox, the shared list) rather than raw elements; the
    linter refuses a raw button, box, dropdown, label or table in the
    apps. A new kind of piece is added to packages/ui (and the component
    catalogue) first, then used.
30. No copy-pasted code: CI runs a duplicate detector (`pnpm duplicates`)
    and fails on any repeated block. Extract it instead. A deliberate
    repeat is marked `jscpd:ignore-start` with the reason.
31. Every field is formatted for what it holds, decided when it is added
    (and checked again when one near it changes): amounts use the shared
    money box ($ and commas as you type), counts and kilometres get commas,
    identifiers (rego, VIN, licence and policy numbers, references) are
    capitals, phones/ABNs/postcodes use their formatters, short numbers
    allow digits only and stop at their length. The same rule is applied
    again on the server when saving. Where no format fits (e.g. a policy
    number whose pattern differs by insurer), say why in the plan.
32. Proper by default: wherever an established library does a job, use it
    rather than building it, even when building looks quicker. Established
    means widely used, maintained (released in the last year), and licensed
    MIT, Apache-2.0, BSD or ISC (never AGPL or "source available"; a tool
    used only in tests may be MPL-2.0, like axe-core). Pin the
    exact version, released at least 14 days ago, and state why in the
    commit. Hand-building is allowed only with the reason written in the
    plan (e.g. the browser's own control is better, or nothing fits).
33. Every screen is proven in a real browser: a new or changed screen gets
    Playwright tests in its app's e2e folder (keyboard use, phone width),
    an axe-core accessibility check (WCAG 2.2 AA, no exceptions without a
    written reason), and a JavaScript download budget. A budget is raised
    only on purpose, with the reason in the commit.
34. Every screen, now and future, uses the agreed look
    (docs/plans/look-and-feel.md, approved by Abhi 6 Nov 2026):
    - the theme;
    - white cards with small capital section labels;
    - status labels that differ in lightness, not only colour;
    - the navy strip on single-item pages;
    - names and regos as bold teal links (navy on hover, never underlined), with the
      rest of a row opening the main thing;
    - one tap per row on phones;
    - tables that become cards on phones.

    A new page gets a mockup in the same style before it is built.

## How to work
- Read the relevant docs/design/*.md file before working on an area.
- For anything touching schema, money, auth or tenancy: show a plan
  first and wait for approval before editing.
- Small, single-purpose changes. Conventional commits.
- Review each slice before it is called done: review only what the
  slice changed, with depth matched to risk. Money, tenancy, logins and
  signing get a deep review where each finding is checked by two
  independent checkers; screens and wording get one quick pass. Every
  bug fixed gets an automatic test so it cannot come back. A full
  review of the whole app happens only before launch, focused on what
  cuts across areas (docs/reviews/2026-11-04-full-code-review.md).
- Every schema change goes through a Drizzle migration. Never edit a
  migration that has already been applied.
- Tests are required for: money and GST calculations, the ledger,
  possession and fine matching, timezone handling, and tenant isolation
  (a test proving Operator A cannot read Operator B's data).
- Don't add a dependency without stating why (rule 32 says which kind).
- Dependency updates come as Renovate pull requests (weekly, only releases
  at least 14 days old, security fixes at once). Each is reviewed and its
  CI must pass; none merges by itself.
- Before pushing: typecheck, lint, unit tests, duplicates, format, both
  builds, and the browser tests of any app whose screens changed
  (`pnpm --filter <app> e2e`). CI runs all of them again.
- Browser tests use made-up data in stores that exist for one run; they
  leave nothing behind (no files, volumes or containers).
- Check the legal side of every task as part of the review: privacy
  (Australian Privacy Principles, data sent overseas), consumer law,
  Spam Act, a third party's terms, record keeping. Write anything that
  needs disclosing or doing in docs/legal-notes.md, and mention it in
  the end-of-task summary.
- Test checklist: every feature, screen, field or button that is added
  or changed gets its row in Abhi's test checklist (Google Sheet "Fleet
  app test checklist", link in docs/progress.md) in the same task: what
  it is, what it should do, how to test it, Result "Not tested", and the
  phase it was added in. A changed row is updated and its Result set back
  to "Not tested"; IDs never change. Read his Result and notes before
  starting each task, and treat an Issue as work to raise. If the Google
  Sheets connector is not available, list the new and changed rows in the
  end-of-task summary for Abhi to paste in.
- Anything relaxed or put off "until launch" goes in
  docs/launch-checklist.md in the same task.
- At the end of every task, give Abhi a short plain-English summary:
  what changed, how to test it on the live dev site, and anything he
  needs to decide.
- Never add AI attribution anywhere: no "Generated with", no
  "Co-Authored-By: Claude", no claude.ai session links, in commits,
  PRs, code comments or docs.
- Every new env var must be added to .env.example, the Zod env schema
  and turbo.json in the same commit.
- All commits use the author and committer identity Abhishek Gendah
  <75556610+AbhishekGendah@users.noreply.github.com>. Set it at the
  start of every session before committing.

## Working with Abhi
- Abhi isn't a deep technical expert. Explain everything in plain
  English. Only use technical terms when unavoidable, and explain
  them when you do.
- When Abhi needs to do something himself (clicking in Vercel, Neon,
  Cloudflare, GitHub, Stripe etc.), give ONE step at a time, then stop
  and wait for him to confirm before giving the next one.
- Ask at most one question at a time.
- For decisions: give a recommendation plus a one-line tradeoff, so he
  can push back. Research online when unsure; don't guess.
- Never weigh how long something will take when recommending or
  building. There is no deadline: build what is right, and fix what
  needs fixing when it needs it. Tradeoffs are about quality, risk and
  the user, never effort or time.
- Before presenting any plan, critically review it yourself as a
  senior engineer would (security, tenancy, money correctness, edge
  cases, anything contradicting the docs) and fix what you find.
- Never ask Abhi to paste secrets or passwords into chat. Tell him
  where to put them (Vercel, GitHub secrets, Bitwarden) instead.
- At the start of every session, read docs/progress.md and tell Abhi
  in two or three lines where things are up to and what's next.
- After every task, update docs/progress.md.
