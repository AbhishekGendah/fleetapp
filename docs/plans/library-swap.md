# Plan — Swap hand-built pieces for established libraries

Status: approved and built (1 Nov 2026). Before Phase 3.

Abhi's decision: wherever an established library does the job, use it,
needed or not, and do it properly from the start, however long it takes.

## Rules for every swap

- **Exact versions pinned**, each with its reason in the commit (CLAUDE.md:
  no dependency without stating why). Only MIT or Apache-2.0 licences, which
  allow commercial use. Nothing AGPL or "source available".
- **Our own function names stay; only what is inside them changes.** For
  example `formatAustralianPhone()` keeps its name but calls libphonenumber-js.
  So the screens and the server code calling it do not change, and the
  existing tests keep proving the behaviour. A test changes only where the
  library is deliberately better (each one listed in the commit).
- **The look stays the same.** Brand colours, sizes and the 44px touch targets
  (rule 24) carry over. The shared pieces stay in packages/ui (rule 29), and
  the component catalogue is updated.
- The server still checks everything with the same Zod schemas (rule 28). A
  library on the screen never replaces a check on the server.
- One stage = one or a few small commits, each with the full checks passing
  (tests, lint, types, duplicates, format, both builds) before it is pushed.

## Checked library choices (versions as of 1 Nov 2026)

| Replaces our hand-built | Library | Version | Licence | Why this one |
|---|---|---|---|---|
| Pop-up forms, searchable make/model box, address suggestions, code box, checkbox | **Base UI** (`@base-ui/react`) through shadcn's components | 1.9.0 | MIT | Made by the Radix, Floating UI and MUI people; shadcn's default since July 2026. Has Dialog, Combobox, Autocomplete and an OTP (code) field, so one library covers all of these |
| `@radix-ui/react-slot` (one small helper) | Base UI's `useRender` | — | MIT | One less library once everything is on Base UI |
| Date maths, local time to UTC, daylight saving, date formatting | **date-fns** + **@date-fns/tz** | 4.4.0 / 1.5.0 | MIT | The most used date library; `TZDate` handles timezones and daylight saving. Temporal (the coming built-in) is not in every browser yet |
| Australian phone formatting and checking | **libphonenumber-js** | 1.13.15 | MIT | Google's phone number rules: every number type, plus overseas numbers |
| Country list for overseas licences | **i18n-iso-countries** | 7.14.0 | MIT | The standard ISO country list with names. Rarely updated because the data rarely changes |
| "Chrome on iPhone" in new-device emails | **Bowser** | 2.15.0 | MIT | Chosen over ua-parser-js, which is now AGPL |
| File type from the file's contents | **file-type** | 22.3.0 | MIT | Knows hundreds of formats, not just our few |
| CSV export | **Papa Parse** | 5.7.0 | MIT | Has formula protection built in (`escapeFormulae`); to be checked against our tests |
| Typo suggestions for makes and models | **Fuse.js** | 7.5.0 | Apache-2.0 | The standard fuzzy search. Exact matching with aliases stays ours (it is a business rule) |
| Shrinking photos on the phone | **Compressor.js** | 1.4.0 | MIT | Handles photo rotation and older phones. Chosen over browser-image-compression, which has had no update since 2023 |
| Full-screen photo viewer | **yet-another-react-lightbox** | 3.33.0 | MIT | Pinch zoom, swipe, keyboard, screen readers |
| Breached-password check | **Better Auth's haveIBeenPwned plugin** | (in better-auth 1.7.5) | MIT | We already use Better Auth; ours duplicates it |
| Form handling (checks as you type, errors, focus on the bad box) | **React Hook Form** + **@hookform/resolvers** (Zod) | 7.91.0 / 7.0.1 | MIT | The standard; shadcn's Form uses it |
| Shared list (sort, columns, paging, phone cards) | **TanStack Table** | 9.3.1 | MIT | The standard headless table; shadcn's data table uses it. Paging and sorting stay in the database |
| List filters, search and page in the address bar | **nuqs** | 2.10.2 | MIT | Standard for Next.js; typed, and it updates the list without reloading the page |
| Money and number boxes formatting as you type | **react-number-format** | 5.4.5 | MIT | $ and commas while typing, digit limits (rule 31) |
| Tests that a real browser can use every piece by keyboard | **Playwright** (`@playwright/test`) | (to pin) | Apache-2.0 | Proves each swap works in a real browser, keyboard and phone size included. It is the browser already installed here |

## Kept as they are, and why (properly, not just to save time)

- **Dropdowns use the phone's own picker** (native select). On phones that
  is the most usable and most accessible dropdown there is; replacing it with a
  custom one would be a step backwards. Searchable boxes do move to Base UI.
- **Tick boxes stay the browser's own checkbox** (decided while building
  stage 5): it is already the accessible standard; Base UI's is a styled copy.
- **Code box on input-otp, not Base UI's OTP field** (decided while building
  stage 5): input-otp keeps one real input behind the boxes, so paste,
  autofill and screen readers treat the code as one field; Base UI's uses
  one input per digit. input-otp is also the one shadcn uses.
- **Car and Renter tabs** stay as links, because they change the page
  address. A tabs library is for panels within one page.
- **Camera capture**: no established library does a live camera with
  sequential photo sending; ours uses the browser's own camera access directly.
- **Android back button closes pop-ups**: needed whatever library is used.
- **Install-app hint, account lockout, session time limit**: Better Auth
  has no lockout of its own; these are our rules.
- **Money maths stays integer cents (rule 9)**, as do ABN check, postcodes,
  licence rules, retention, settings, the ledger to come: these are our
  business rules, with no established Australian library, and fully tested.
- **Excel download** (write-excel-file), QR code, icons, email templates,
  S3, database: already established libraries.

## Stages (in this order)

1. **Browser tests first.** Add Playwright: the app runs against the test
   database, and tests cover keyboard and phone-size use of every piece about to
   change (pop-ups, searchable boxes, code box, forms, lists). They are written
   against today's behaviour, so each swap is proven not to break anything.
2. **Behind-the-scenes rules (no screen change):** dates, phone, countries,
   device names, file types, CSV, typo suggestions. One commit each. The
   timezone and date tests stay exactly as they are (required tests).
3. **Breached-password plugin** (touches sign-in, hence this plan). It must
   cover every place a password is set: invite acceptance, reset, change. If
   the plugin cannot reach one of them, that place calls the plugin's own
   check, never a second copy.
   *As built:* the plugin refuses leaked passwords, and refuses every password
   while the breach service is down; both go against Abhi's "warn, don't
   refuse" decision. So Better Auth's exported check (`isPasswordCompromised`)
   is used on its own for the warning, and our hand-made copy is gone.
4. **Photos:** Compressor.js for shrinking (same size targets as rule 21),
   then the lightbox viewer.
5. **Base UI pieces:** pop-up forms, searchable make/model box, address
   suggestions, code box, checkbox. Then remove the Radix helper. Catalogue updated.
6. *As built:* `useFormFields` keeps its whole API and runs on React Hook
   Form underneath ("onTouched" mode is rule 28's "checked once left, then
   with every key"). Our `validate` (the server's Zod schema) is its
   resolver, so @hookform/resolvers is not needed. `FormField` now links its
   hint and message to whatever box it holds, on every form.
6. **Forms on React Hook Form:** the shared field wiring first, then every
   form one at a time. Asterisks, required notes, and screen readers reading
   hints and errors (rule 28, review C1) all carry over.
7. **Lists on TanStack Table and nuqs:** the shared list first, then each of
   the 12 lists. CSV and Excel downloads unchanged.
8. **Money and number boxes on react-number-format**, with the server's
   check unchanged.

Each stage ends with the checks, a push, checklist rows, and progress notes.

## Already planned for Phase 3 (from day one, not built by hand)

React Aria Components (date pickers and ranges, Adobe, Apache-2.0),
signature_pad (signatures), @react-pdf/renderer (contracts and reports),
Serwist plus Dexie (checklist that survives poor signal, rule 25). For the
booking calendar: FullCalendar or react-big-calendar. **To decide in the
Phase 3 plan:** FullCalendar's "cars down the side, days across" view is in
its paid Premium tier. react-big-calendar is free but simpler.

## Risks and how they are handled

- **Many screens change underneath.** The browser tests (stage 1) and the
  unchanged unit tests catch any change in behaviour. Every changed screen's
  checklist row goes back to "Not tested" (Abhi is testing at the end anyway).
- **More dependencies to keep up to date** (about 17). All are widely used and
  maintained (each updated within the last few months, except the country
  list, whose data is stable). Updates are pinned and done on purpose, never
  automatically.
- **Download size on phones**: each stage's build size is checked. A piece
  that grows a page a lot is loaded only when needed (e.g. the lightbox).
- **Behaviour the libraries change on purpose** (e.g. typo suggestions
  ranked differently): listed in each commit and in the summary.

## Legal side

- All licences allow commercial use. Apache-2.0 (Fuse.js, Playwright, React
  Aria later) asks that its notice is kept: a "third-party licences" list is
  generated with the build. Added to docs/legal-notes.md.
- Breached-password check: as today, only the first 5 characters of a
  fingerprint of the password leave our server (the "k-anonymity" method),
  never the password. Nothing new is sent overseas.
- No new service receives personal data: everything in this plan runs on
  our own servers or in the browser.

## Decisions in this plan (pushed back on easily)

1. **Base UI, not Radix,** for the interactive pieces. Tradeoff: newer than
   Radix (stable since Dec 2025), but it is where shadcn and the Radix authors
   are going.
2. **Keep the phone's own dropdown** rather than a custom one. Tradeoff: it
   looks slightly different on each phone, but it is the easiest to use there.
3. **Keep our function names, swap what is inside them.** Tradeoff: a thin
   layer of our own, but the rest of the app and its tests do not change.
4. **Playwright browser tests before anything moves.** Tradeoff: a first stage
   with no visible change, but every later stage is proven.
