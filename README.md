# fleetapp

Multi-tenant SaaS for Australian vehicle rental businesses, built by Altus
Global Solutions (AGS). See [`CLAUDE.md`](./CLAUDE.md) for the project
rulebook and [`docs/design/`](./docs/design/) for how each part of the
product works.

This is currently the skeleton, the tenancy foundation and the AGS admin
login: a working pnpm/Turborepo monorepo, the platform tables with
row-level security on them, an admin app you can sign in to with a
password and an authenticator app, and CI. No Operator app login yet, no
vehicles or renters, no payments — that all comes in later tasks.

## What's in here

- `apps/web` — the Operator app (and, later, the pages Renters open from a
  link).
- `apps/admin` — the AGS admin area, a separate app on its own subdomain.
- `packages/ui` — shared Tailwind CSS + shadcn/ui components (`Button`,
  `Card` so far).
- `packages/db` — Drizzle ORM setup, migrations and the tenancy rules for
  the Postgres database: Operators, Users, Admin Users and the activity
  log, plus the row-level security that keeps one Operator out of
  another's data.
- `packages/core` — pure domain logic (money, dates, ledger, fine
  matching). Empty until a later task adds it.
- `packages/config` — shared TypeScript, ESLint and Prettier config used by
  everything above.

## Running it locally

You'll need Node (version pinned in `.nvmrc`) and pnpm (pinned in
`package.json`'s `packageManager` field — run `corepack enable` to get the
right version automatically).

1. Install dependencies:

   ```
   pnpm install
   ```

2. Copy each app's `.env.example` to `.env.local` (and
   `packages/db/.env.example` to `packages/db/.env`) and fill in real
   values, or ask Abhi for the dev database credentials. Two different
   Neon connection strings are involved: `DATABASE_URL` (runtime) uses
   Neon's **pooled** connection; `DATABASE_MIGRATION_URL` (drizzle-kit
   only) must use Neon's **direct/unpooled** connection — the pooled one
   doesn't reliably support the session-level operations migrations need.

3. Run everything in dev mode:

   ```
   pnpm dev
   ```

   `apps/web` runs on port 3000, `apps/admin` on port 3001.

## Common commands

All of these run across every app/package via Turborepo — add
`--filter=web` (or `admin`, `@fleetapp/db`, etc.) to target just one.

| Command            | What it does                                     |
| ------------------ | ------------------------------------------------ |
| `pnpm dev`         | Run every app in dev mode                        |
| `pnpm build`       | Production build of every app                    |
| `pnpm lint`        | ESLint across every app/package                  |
| `pnpm typecheck`   | `tsc --noEmit` across every app/package          |
| `pnpm test`        | Run tests (`packages/core` and `packages/db`)    |
| `pnpm db:generate` | Generate a Drizzle migration from schema changes |
| `pnpm db:migrate`  | Apply migrations to the database                 |

## Tenancy

Every tenant-owned table carries `operator_id` and has Postgres row-level
security enabled **and forced**, so the database refuses cross-Operator
reads even if application code asks for them. Application code never
queries those tables directly — it goes through `withTenant()` in
`packages/db/src/tenant-context.ts`, which opens a transaction and sets the
Operator for that transaction only.

`packages/db`'s tests prove this against a real Postgres: they run the
actual migrations, connect as the real application roles, and check that
Operator A cannot see Operator B's rows. They also walk the live schema and
fail if any table was added without tenant scoping.

Those tests start `postgres:17-alpine` in Docker. If you already have a
Postgres running, or Docker image pulls are blocked, point them at it
instead:

```
TEST_POSTGRES_SUPERUSER_URL=postgres://postgres:password@127.0.0.1:5432/postgres pnpm test
```

## Logging in to the admin app

Three database roles, not two: `admin_auth_role` is used only by the
login system and is the only one granted anything on the Admin
credential tables. `admin_app_role`, which runs the rest of the admin
app, can reach none of them — so a bug in an Operator list or a report
has no connection on which a password hash is readable.

Admins sign in with an email, a password and a code from an
authenticator app, every time. "Remember this device" is deliberately
off: an Admin account reaches every Operator.

The first Admin is created by a command, not a web page, so there is no
setup endpoint to find or forget to disable. It refuses to run once any
Admin exists:

```
pnpm --filter admin create-first-admin "you@example.com" "Your Name"
```

`BETTER_AUTH_SECRET` encrypts every authenticator enrolment. **If it is
lost or changed, every Admin has to enrol their authenticator app
again.** Keep it in Bitwarden as well as in Vercel.

## Migrations

`pnpm db:migrate` applies migrations locally. On every push to `main`, the
`Migrate database` workflow runs them against the dev database using the
`DATABASE_MIGRATION_URL` GitHub secret.

That workflow and the Vercel deploy start from the same push, so **every
migration must be backwards compatible with the code already deployed**:
add columns and tables in one release, remove them in a later one.

## Checking it's alive

Each app exposes `GET /api/health`, which returns
`{ "status": "ok", "database": "ok" | "error" }` — `database` reflects
whether a `SELECT 1` against Postgres succeeded, without ever returning
connection details or error internals.
