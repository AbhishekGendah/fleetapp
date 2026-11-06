# Abhi's quality-of-life suggestions

Status: collecting (from 6 Nov 2026). **Nothing here is built until Abhi
says go.** Admin A1 to A8 approved and built on 6 Nov (see As built). Each suggestion has the recommendation given to him; once he has
been through both apps, they become a plan for approval, together with the
nine improvements in docs/plans/look-and-feel.md.

## Admin site

| # | Page | Suggestion | Recommendation |
|---|---|---|---|
| A1 | Home | Open on a home page with useful facts, not the Operators list | Yes: businesses (active, suspended), invites waiting or expired, setup not finished (Stripe, no cars), last sign-in, storage; later subscriptions and overnight failures. No Renter personal data (rule 5). |
| A2 | Operators | Search as you type | Yes, everywhere (shared list toolbar): about 0.3 s after typing stops. Today it waits for Enter. |
| A3 | Operators | New Operator in a pop-up | Yes, like adding things in the Operator app; the pop-up confirms the invite and links to the business. |
| A4 | Operators/new | Are the four details enough? Do we approve what they enter? | Enough: the business enters the rest through its setup checklist. No approval step today; recommend none (AGS creates every business), with setup progress shown on the admin home. Optional: check the ABN against the government ABN lookup. |
| A5 | Operator page | Address is a long ID; sub-pages instead of one page | Keep the ID (stable when renamed). Tabs: Details, Invites and sign-ins, Log, later Billing. |
| A6 | Operator page | Log paging | Yes: today it shows only the last 50 lines (OPERATOR_HISTORY_LIMIT). Use the shared list with pages and a filter by kind. |
| A7 | Operator page | More sections | Yes, as built: Stripe status, setup progress, last sign-in and history, storage, reset authenticator, billing (Phase 8). |
| A8 | Whole site | Top bar stays put when scrolling | Yes, kept slim. |

## Both apps

| # | Page | Suggestion | Recommendation |
|---|---|---|---|
| B1 | Everywhere | Buttons don't show the pointing hand | Fixed 6 Nov (shared styles; browser test). |
| B2 | Everywhere | Everything feels a bit slow | Instant "loading" placeholders on every page; tabs swap content instead of reloading the page; Vercel Speed Insights to measure (one package, MIT). Production kept awake: launch checklist. Awaiting go. |

## Operator app

(To come.)

## As built: admin site (6 Nov 2026)

- **A1** Home page at `/` (apps/admin/src/app/page.tsx): businesses by status
  (counts open the filtered list), "Not set up yet" (signed up, no ABN or
  Stripe not ready), signed in in the last 7 days, storage used. Worked out
  in apps/admin/src/lib/operators/home-summary.ts from the Operator list:
  no new database access, no Renter data. Car counts left out: the admin
  login can't read cars, by design.
- **A2** Search as you type in the shared list toolbar (both apps), 0.3 s
  after the last key; typing replaces the history entry instead of adding
  one; Enter and Search still apply at once.
- **A3** New Operator in a pop-up (home and Operators list); the form loads
  only when it opens. /operators/new still works.
- **A5** A business's page split into Details, Invites and Log, each its own
  address (/operators/[id], /invites, /log), sharing one header.
- **A6** The Log uses the shared list: the latest 1,000 lines, 25 a page,
  search, and a By filter.
- **A7** "Setup and use" on Details: business details, Stripe payments and
  payouts, direct-debit status, last sign-in, storage.
- **A8** The top bar stays put (both apps); the logo goes Home (both apps,
  its spoken name keeps the visible words, WCAG 2.5.3).
- Budgets: admin `/` and `/operators` raised 180 to 220 KB for the pop-up.
- Tests: admin browser tests for the home page, tabs, pop-up and search as
  you type; a database test for the home summary and setup facts.

