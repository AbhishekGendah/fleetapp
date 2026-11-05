# Review fixes, batch 6: database update safety (plan, waiting for Abhi)

From docs/reviews/2026-11-04-full-code-review.md, fix order item 6: before
moving to branches and pull requests. These items change how database
updates (migrations) run and how the apps go live, so nothing is built
until this is approved. Each item was checked against the code on
5 Nov 2026 and is real.

The rule for this batch: **a database update is never skipped without
anyone knowing, is proved on a database that already has data in it, and
always lands before the code that needs it.**

## How it works today

- Every push to `main` runs CI; when CI passes, a GitHub job runs Drizzle's
  `drizzle-kit migrate` against the dev database.
- Vercel builds and puts the new code live straight from the push, without
  waiting for CI or the database update.

## 1. Updates can be skipped silently (G1-1, serious)

Cause (checked in Drizzle 0.45.2's own code): Drizzle runs only the updates
dated after the newest one it has already run. So:
- an update that is edited after it has run is never run again, and nobody
  is told;
- an update merged later than a newer one (likely once we work on branches)
  is skipped for ever, and the run still says success.

Fix: our own small update command in packages/db, used everywhere instead of
`drizzle-kit migrate`. Before changing anything it compares the updates in
the repo with those recorded in the database, and **stops with a clear
message** if:
- one already run has been edited since (its fingerprint differs);
- an older one has never been run while a newer one has (out of order);
- the database has one the repo doesn't know about.

Then it runs the waiting updates with Drizzle's own runner, holding a
database lock so two runs can never overlap. CI gets the same check, so an
edited update fails the build before it gets near a database.

## 2. Updates are only tested on an empty database (G1-2)

Fix: a new CI check, "update a filled database":
1. Build a throwaway database from `main` as it is now (its updates and its
   code).
2. Fill it with the demo data (every kind of record: Renters, cars,
   bookings, handovers, money, invoices, changes, swaps, damage), using
   `main`'s own demo-data code, so the data looks like the real database.
3. Run this change's new updates on it with the command from item 1. Fail if
   any update fails.
4. Run the database tests' structure checks on the result (every table
   tenant-scoped and protected).

The demo data runs from a new small script, so the check can fill a database
without anyone signing in.
- **First time:** `main` doesn't have this script yet, so the check
  fills with what the database tests seed. From the next change on, it uses
  the full demo data.

## 3. Code goes live before its database update (G1-3)

**Abhi's decision** (below). Recommendation: GitHub puts the apps live, in
order, instead of Vercel doing it on the push:
1. CI passes.
2. The database update runs (item 1).
3. Only then are both apps put live, from exactly that commit, with
   Vercel's own command-line tool.

If the update fails, the code doesn't go live and the old code keeps
working. Every update must still work with the code already live (add
first, remove later), as now.

What Abhi does, one step at a time when we get there: make a Vercel access
token and put it in GitHub's secrets (the project IDs aren't secret and go
in the repo).

Then Vercel's automatic deploys from `main` are turned off in each app's
`vercel.json` (preview links for branches keep working). That switch is
only made once the token is in place and a test deploy through GitHub has
worked, so the apps can never stop deploying. Until then nothing changes.

## 4. No written plan for the live database (G1-3)

Fix: a runbook, docs/runbooks/production-database.md, saying in plain steps:
- **setting up:** the production database in Sydney (Neon), separate from
  dev; the same four logins with the same rights, checked with the existing
  role check; the update login kept only in GitHub's secrets;
- **updating:** only through the job in item 3; never by hand; what to do
  if an update fails (nothing went live; fix forward with a new update);
- **backups:** Neon's point-in-time restore window for production (at least
  7 days; check what the plan includes), and a test restore done once
  before launch and then every three months, onto a throwaway branch,
  never over the live data;
- **who can reach it:** Abhi only, with two-step sign-in on Neon.

The launch checklist gets each of these.

## 5. Notes and a setting that aren't right (G1-5, small)

- The update job's address setting (`DATABASE_MIGRATION_URL`) is checked
  with Zod, as rule 6 says, with a plain message if it's missing or not a
  Postgres address.
- The notes in migrate.yml are corrected:
  - **the lock:** it mentions a safety lock that doesn't exist (item 1 adds
    a real one);
  - **all-or-nothing:** it says waiting updates run all-or-nothing, which
    Drizzle does, so that stays, worded plainly;
  - **order:** it describes the race between Vercel and the update, which
    item 3 removes.

## Database changes

None to the tables. The update command adds a lock while it runs and reads
Drizzle's own record of what has run.

## Tests

- **The update command:**
  - an edited update is refused;
  - an out-of-order one is refused;
  - an unknown one in the database is refused;
  - waiting updates run and are recorded;
  - running twice changes nothing;
  - two at once never overlap.
- **The filled-database check:** proved to fail on purpose by an update that
  would break on real data (e.g. a new required column with no default),
  then removed.
- **Deploys:** checked on a branch push with Vercel's preview, before
  switching `main` over.

## Senior review of this plan

- **Safety:** nothing here changes data. A refused update stops before
  touching the database. Code never goes live ahead of its update.
- **Rollback:** a failed update leaves the old code live and the database
  as it was (all-or-nothing). A bad update that ran is fixed with a new
  update, never by editing the old one; item 1 enforces that.
- **Secrets:** the Vercel token and database address only in GitHub
  secrets; never printed in logs.
- **Tenancy:** unchanged; the structure checks run on the updated filled
  database too.
- **Not in this batch:** moving to branches and pull requests itself (on
  the launch checklist), and the production database's creation (the
  runbook describes it; Abhi does it before launch).

## Decision for Abhi

**Who puts the apps live.** Recommendation: GitHub, after the database
update, from exactly the commit that passed (item 3). Tradeoff: a few
minutes slower to go live, and it needs a Vercel token in GitHub's secrets.
In return, the app can never run against a database that isn't ready, as
happened on 3 Nov.
