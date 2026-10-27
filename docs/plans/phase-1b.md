# Phase 1b plan

Status: approved. Slice 1 built; slices 2 to 4 not started.

Phase 1b gives the Operator app its look, its settings and its file
storage, and builds the one list screen every later list will reuse.
Four slices, each deployed and tested on the dev site before the next.

## Slice 1 — Look and feel

Goal: PintoFleet looks like a product, and every screen built from here
on inherits that look for free.

- **The brand file**, `packages/ui/src/brand.ts`: the name PintoFleet,
  the placeholder logo, the colours. The only place the name is typed
  (CLAUDE.md).
- **Colours, taken from the PintoTech emblem** (approved by Abhi from
  a mock-up, replacing the first teal proposal):
  - Deep navy `#0D3747` for main buttons and headings.
  - Teal `#167884` (the logo's cyan, darkened to be readable as text) for
    links and the current tab.
  - The logo's own cyan `#2FA7B4` for decoration only: progress bars,
    icons. Too light to carry text.
  - Amber `#B45309` for "needs attention", red for errors, slate greys.
- **Type**: Manrope for everything, served with the app.
- **Logo**: the PintoTech emblem with a drawn PINTOFLEET wordmark: the
  PintoTech letters, with F and L built from its E. The emblem is also
  the browser-tab icon.
- **The app shell** (Operator app): on a phone, a bottom tab bar with
  44px+ targets; on a wider screen, a sidebar. Only sections that exist
  appear in it (Home and Settings for now); each later phase adds its own.
- **Admin** gets the same theme, plus a clear "Admin" label, so the two
  apps never get confused.
- **Emails** use the name and colour from the brand file.
- **Settings to change in Vercel** (Abhi, one step at a time):
  `AUTH_ISSUER_NAME` to `PintoFleet` (Operator app) and
  `PintoFleet Admin` (admin app); the name in `EMAIL_FROM` on both.
  Authenticator entries already made keep their old names; harmless.

Before building the shell around it, a sample screen is shown to Abhi
at phone and desktop width for sign-off.

Not in v1: dark mode. Easy to add later because every colour comes from
the theme.

## Slice 2 — Operator settings

Goal: an Operator can fill in and edit their business details, which
ticks the first setup step; and there is one place every later setting
will live.

### Business details (on the existing `operators` table)

Legal name, trading name, ABN, GST registered (and from when), address,
phone, email, timezone. The Operator app may already edit exactly these
columns and no others (slice 1 of 1a), so no permission changes.

- **ABN checked properly**: 11 digits and the official ATO checksum, so
  a typo is caught at entry. A pure function in `packages/core`, tested.
- **GST**: "registered from" is required when registered, and refused
  when not. Charges later use it to decide GST.
- **Timezone**: chosen from every Australian zone, with plain names
  (including the odd ones: Broken Hill runs on Adelaide time, Eucla and
  Lord Howe have their own). It only changes how times are shown;
  everything is stored in UTC (rule 10).
- **Address**: the state is chosen from the list; the postcode must be
  4 digits. If it does not look like it belongs to that state (for
  example a 6xxx postcode outside WA) the form warns but still saves:
  postcode ranges overlap and have exceptions (parts of the ACT sit in
  NSW ranges), and refusing would sometimes block a real address.

### Where every other setting will live: `operator_settings`

One row per Operator holding all the other settings (reminder days, bond
hold, late fee and so on) as one validated document, rather than one
column each.

- **Defaults live in code, not in the row**: a setting nobody has
  changed is read as its default. Adding a new setting in a later phase
  needs no data migration and no backfill, and every Operator gets the
  sensible default straight away (rule 27).
- **Validated at every boundary** with Zod, so a bad value cannot get in
  even though the database sees one document.
- **Versioned**: each save bumps a version number. A rental will record
  the version and a full copy of the settings when it is created
  (rule 14). The copy-taking function is built and tested now, ready for
  Phase 3.
- **Every change logged** with before and after values (rule 19).
- Tenant-owned: `operator_id` primary key, row-level security forced,
  the usual isolation tests.

Tradeoff: the database cannot check each setting on its own; the Zod
schema does that, in one place, for every write.

Only settings whose features exist get a screen. In 1b that is business
details alone; each later phase adds its own section and defaults. No
screen offers a setting that does nothing yet.

### Screens

A Settings page with sections; "Business details" is the first. The
setup checklist's first step links to it.

## Slice 3 — File storage

Goal: files can be stored safely, ready for car photos and Renter
documents in Phase 2. The first real use is the Operator's logo.

### Storage

- **Amazon S3 in Sydney** (ap-southeast-2), behind a storage interface
  so tests run without AWS and the provider could change.
- **Two buckets for dev now** (two more for production later): one for
  general files, one only for identity documents (rule 8). Both block
  all public access and encrypt everything.
- Every file's address in the bucket starts with its Operator's ID, and
  a `files` table records each one with `operator_id`, under forced
  row-level security.
- **Files are only ever shown through links that expire within
  minutes**, issued by server code after checking who is asking.

### Uploading

1. The browser shrinks photos first: about 1600px on the long edge and
   about 400 KB, plus a small thumbnail (rule 21). This also turns
   iPhone HEIC photos into JPEG.
2. The server hands out a one-time upload permission for one exact
   location, size limit and type. The file goes straight from the
   phone to S3, not through our servers, which keeps uploads fast on
   poor signal.
3. The server then reads the first bytes of the stored file and checks
   it really is a JPEG, PNG, WebP or PDF, whatever its name says
   (rule 22). Anything else is deleted and refused.

Limits: images 5 MB after shrinking, PDFs 10 MB.

### Housekeeping (rule 23)

- **Deleting a file** hides it at once and keeps it for 30 days, then a
  daily job removes it for good.
- **Abandoned uploads** (permission issued, never finished) are cleaned
  up by the same daily job after 24 hours.
- **Storage used** per Operator is worked out from the `files` table and
  shown in the admin Operator list. Admin can see sizes only: the admin
  app's role is granted the size and status columns, not file names or
  locations.
- **Moving old rental photos to cheaper storage** after a year needs
  rentals, so it is built in Phase 3.

The daily job runs on Vercel's scheduler, protected by a secret only
Vercel and the app know. It has no signed-in User, so it works one
Operator at a time with that Operator's tenant context set (rule 3). It
finds which Operators have files due through a narrow database function
that returns Operator IDs and nothing else, rather than a role that can
read every Operator's files.

### Logo

Upload, replace or remove the logo in Business details. Shown in the
Operator app header. Not in emails yet: an email outlives any expiring
link, so emails keep using the business name in text until there is a
deliberate decision on public logos.

### What Abhi sets up (one step at a time, when we get there)

An AWS account (if there isn't one), the two dev buckets, and a
login for the app limited to exactly those two buckets.

Tradeoff: that login is a long-lived key kept in Vercel. Before
production, swap it for Vercel's keyless connection to AWS (OIDC), which
removes the key altogether but is fiddlier to set up.

## Slice 4 — The shared list

Goal: the one list component every list in the product uses
(docs/design/08): sorting, filtering, search, export, and cards on a
phone.

- A table on a wide screen, cards on a phone (rule 24), from one
  definition of the columns.
- Tap a column to sort, a search box, and simple filters (for example
  status).
- **Export to CSV and Excel** of exactly what is filtered, all pages of
  it, built on the server from the same filters and scoped to the
  signed-in Operator like any other query. Cells that
  start with `=`, `+`, `-` or `@` are neutralised, so an exported file
  cannot run a formula when opened (a known spreadsheet attack).
- First real use: the admin Operator list moves onto it. Phase 2's car
  and Renter lists are the next.
- Paging is built in from the start, so a list never loads everything.

## New dependencies

| Package | Why |
|---|---|
| `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post` | Amazon's own library for S3, and the upload permissions in slice 3 |
| `write-excel-file` | Excel export in slice 4. Small, MIT-licensed, actively maintained. Chosen over `exceljs`, which has had no release in nearly two years |

Inter comes through Next.js's own font loader, so it adds no
dependency.

## New settings

| Setting | App | Slice |
|---|---|---|
| `STORAGE_BUCKET`, `IDENTITY_STORAGE_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Operator app only. Admin's "storage used" comes from the database, so admin needs no AWS keys | 3 |
| `CRON_SECRET` | Operator app | 3 |

Each one goes into `.env.example`, the startup checks and `turbo.json`
in the same commit.

## Tests

- ABN checksum, postcode-state warning, timezone list: pure tests.
- Settings: defaults fill in for an empty row; an invalid value is
  refused; saving bumps the version and logs before and after; the
  rental snapshot is a full, frozen copy.
- Operator A cannot read or change Operator B's settings or files.
- Files: a file whose bytes are not what it claims is refused and
  deleted; a deleted file is gone from view at once and purged after
  30 days; an abandoned upload is cleaned up; the daily job refuses a
  call without the secret, and touches each Operator's files only with
  that Operator's context set.
- Confirming an upload checks the file belongs to the signed-in User's
  Operator, never to an ID the browser sent.
- Admin can read file sizes but not names or locations.
- List: sorting, filtering and paging; export neutralises formula cells.

## Not in Phase 1b

- Settings for vehicles, Renters, rentals, money and fines: each arrives
  with its phase.
- Logos in emails and on PDFs.
- Moving old photos to cheaper storage (Phase 3).
- Postmark (still the test inbox).
- Dark mode.
