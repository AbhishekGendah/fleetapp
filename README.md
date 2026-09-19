# fleetapp

Multi-tenant SaaS for Australian vehicle rental businesses, built by Altus
Global Solutions (AGS). See [`CLAUDE.md`](./CLAUDE.md) for the project
rulebook and [`docs/design/`](./docs/design/) for how each part of the
product works.

This is currently just the project skeleton: a working pnpm/Turborepo
monorepo with two empty Next.js apps, a shared UI kit, a database package
with no domain tables yet, and CI. No auth, no domain data, no payments —
that all comes in later tasks.

## What's in here

- `apps/web` — the Operator app (and, later, the pages Renters open from a
  link).
- `apps/admin` — the AGS admin area, a separate app on its own subdomain.
- `packages/ui` — shared Tailwind CSS + shadcn/ui components (`Button`,
  `Card` so far).
- `packages/db` — Drizzle ORM setup and migrations for the Postgres
  database. No tables yet.
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
   values. See the pull request that introduced this skeleton for exact
   Neon/Vercel setup steps, or ask Abhi for the dev database credentials.

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
| `pnpm test`        | Run tests (currently just `packages/core`)       |
| `pnpm db:generate` | Generate a Drizzle migration from schema changes |
| `pnpm db:migrate`  | Apply migrations to the database                 |

## Checking it's alive

Each app exposes `GET /api/health`, which returns
`{ "status": "ok", "database": "ok" | "error" }` — `database` reflects
whether a `SELECT 1` against Postgres succeeded, without ever returning
connection details or error internals.
