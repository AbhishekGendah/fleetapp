# The live database: setting up, updating, backups

How the production database is made, changed and protected (review G1-3,
batch 6). The dev database works the same way, with fake data only.

## Setting up (before the first real business)

1. In Neon, a **separate project** for production, in **AWS Sydney
   (ap-southeast-2)**. Never a branch of the dev project: production data
   must never sit next to test data.
2. Make the four app logins with docs/runbooks/database-roles.md (never
   Neon's "Add role" screen). Passwords in Bitwarden, then in the
   production Vercel projects only.
3. The **owner** login's direct (not pooled) address goes in GitHub only,
   in a GitHub **Environment called `production`** with its own
   `DATABASE_MIGRATION_URL`, Vercel project IDs and approval by Abhi. Today's
   secret of that name (no environment) is the dev database's, and the
   "Migrate and deploy" job serves dev; the production job is added with the
   production setup, before launch (launch checklist). Nobody runs updates
   by hand.
4. Run the first deploy (below). The apps' start-up role check refuses to
   start if a login is wrong.
5. Neon account: Abhi only, with two-step sign-in on.

## Updating (every release)

Only through GitHub's "Migrate and deploy" job, after CI has passed:

1. `pnpm db:migrate` runs the waiting updates, all or nothing, under a
   lock. It **stops without changing anything** if an update that already
   ran was edited, if one is older than updates already run, or if the
   database has one the repo doesn't know.
2. Only if that worked are both apps put live, from exactly that commit,
   and only if it is still the newest commit on `main` (an older commit's
   run does nothing, so it can never replace newer code).
3. The two apps deploy separately. If one deploy fails and the other
   worked, the old version of the failed app is still running, which is
   safe as every update works with the old code: re-run the failed deploy
   job in GitHub, or push a fix.

Every update must work with the code already live while it runs (add
first, remove in a later release).

**If an update fails:** nothing went live; the old code keeps working on
the old database. Fix it with a **new** update, never by editing the one
that failed or any that ran. CI's "update a filled database" check exists
to catch this before it happens.

**Never** run SQL by hand on production to "fix" something: write an
update, so the change is reviewed, tested and recorded.

## Backups

- **Point-in-time restore:** Neon keeps the database's history and can
  restore to any moment inside its window. Set production's window to at
  least **7 days** (check what the Neon plan includes; a longer window is
  worth paying for once real businesses use it).
- **Test restore:** once before launch, then every three months:
  1. In Neon, make a **new branch** from production at a time an hour ago
     (never restore over the live data).
  2. Connect to the branch and check a few counts (businesses, Renters,
     rentals, money lines) look right.
  3. Delete the branch. Note the date in docs/progress.md.
- **Restoring for real** (data lost or damaged): make a branch at the
  moment just before the damage, check it, then switch production to it in
  Neon. Tell Abhi first; this affects every business.
- **Files** (PDFs, photos) are in S3, not the database: versioning and the
  30-day recovery are set on the buckets (docs/launch-checklist.md).

## Who can reach it

- Abhi only, on Neon and GitHub, both with two-step sign-in.
- The apps reach it only through the four logins; AGS staff only through
  the admin app (which can't read Renters' personal details).
- The owner login is used only by the update job.
