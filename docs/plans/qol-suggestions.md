# Abhi's quality-of-life suggestions

Status: collecting (from 6 Nov 2026). **Nothing here is built until Abhi
says go.** Each suggestion has the recommendation given to him; once he has
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

## Operator app

(To come.)
