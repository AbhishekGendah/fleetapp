# Look and feel: theme and everyday improvements

Status: draft for Abhi's approval (6 Nov 2026). Screens only: no schema,
money, auth or tenancy changes. Direction chosen by Abhi on 6 Nov:
**A (Calm and clear), with B's navy summary strip on a rental's page**
(the canvas: claude.ai artifact "Fleet app look: 3 directions").

## Part 1: the theme (direction A)

Everything is drawn from the shared pieces in packages/ui (rule 29), so most
of this is a change to those pieces and every screen follows.

- **Colours stay the logo's**: navy for text and main buttons, teal for
  links and the current tab, cyan for decoration only. Page background a
  touch cooler (#F5F7F9); cards white.
- **Cards**: rounder (16 px corners), a soft shadow instead of a grey
  outline, more padding. Section labels small and in capitals
  ("NEEDS ATTENTION"), the card's main fact large.
- **Status labels**: one shared "chip" piece (Due soon, Missing, Out,
  Available, Workshop, Paid…), each colour also differing in lightness so
  colour-blind people can tell them apart (rule 24, WCAG).
- **Big numbers** where they matter: what's owing, cars out/available/in
  the workshop.
- **Buttons**: main action navy, full-width on phones, at least 48 px tall;
  secondary actions soft grey-teal.
- **Rental page**: B's navy strip at the top with the rego, status, what's
  owing and the next rent, then the cards.
- **Tab bar**: icons with labels; the current tab in navy.
- Emails and PDFs keep their own simple style (email apps ignore most
  styling); only their colours follow the brand file.

How it's checked: every screen's browser tests and accessibility checks
(axe, WCAG 2.2 AA) at phone and desktop width, the download budgets, and a
screenshot of each main screen before and after for Abhi to compare.

## Part 2: everyday improvements (tick the ones you want)

My recommendation first in each; the tradeoff in one line.

1. **The logo is the Home link** (Abhi's idea), in the header and the
   sidebar, as on the admin site. Recommendation: do it everywhere, and on
   phones **keep** the Home tab in the bottom bar too. Tradeoff: one
   duplicate way home; in return phone users keep the thumb-reach tab every
   phone app has (the logo is at the top, hard to reach one-handed).
   Alternative: drop the Home tab on phones too, leaving four tabs.
2. **Account menu instead of a Sign out button**: a round initial in the
   header opens Business details, Settings and Sign out. Tradeoff: sign out
   is one more tap; in return the header is cleaner and can't be
   tapped by accident.
3. **Search from anywhere**: one search box in the header that finds a car
   by rego, a Renter by name or phone, or a rental, and opens it. Tradeoff:
   a small amount of new code; in return the most common job (find this car
   or this person) is one step from every page.
4. **The next step as the main button** on a rental: Send contract, Start
   handover, Start return or Close, whichever is next, always at the top
   under the navy strip. Tradeoff: none worth noting.
5. **Tap to call, text, email or map**: Renters' phones, emails and
   addresses become links that open the phone's own app. Tradeoff: none.
6. **Friendlier dates**: "Today 10:00", "Tomorrow", "Thu 13 Nov" instead
   of full dates where it's clear. Full date on hover/long-press. Tradeoff:
   none; documents (PDFs, invoices) keep full dates.
7. **Empty pages say what to do next**: e.g. "No rentals yet. Add a car,
   then a Renter, then a rental" with the buttons. Tradeoff: none.
8. **Same "Saved" message everywhere**: a short confirmation that appears
   and fades, in one shared piece, instead of each form's own line.
   Tradeoff: messages that need reading (warnings) stay on the page.
9. **Admin Suspend asks with the shared "Are you sure?"** instead of the
   browser's plain pop-up (flagged 5 Nov, rule 29). Tradeoff: none.

Abhi's own: add any more here, or mark them in the test sheet's notes as
you test (an "Issue" or a note on a row is enough).

## How it's built

- Slice 1: the theme in packages/ui and the app frame (header, sidebar,
  tab bar, logo as Home, account menu); the component catalogue updated.
- Slice 2: the dashboard and the rental page (navy strip, next-step
  button, chips, big numbers).
- Slice 3: the improvements Abhi ticks (search, tap to call, dates, empty
  pages, saved messages, admin Suspend).
- Each slice: browser tests updated, accessibility at phone and desktop
  width, budgets, test sheet rows, and before/after screenshots for Abhi.

## Not in this plan

- New features (weekly debits etc.: Phase 4 plans).
- A dark mode (possible later; not asked for).
- Renaming the product (one file, packages/ui/src/brand.ts, when needed).
