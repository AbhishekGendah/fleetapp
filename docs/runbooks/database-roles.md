# Database logins (roles): how to make them

The apps never connect as the database's owner. Each runs on a login
(Postgres "role") that **can't bypass row-level security**, the second lock
that keeps each business's records apart (CLAUDE.md rule 2). Four are needed
on every database (dev and production):

| Login | Used by | What for |
| --- | --- | --- |
| `web_app_role` | Business app (`DATABASE_URL`) | Everything but signing in |
| `web_auth_role` | Business app (`AUTH_DATABASE_URL`) | The login system only |
| `admin_app_role` | Admin app (`DATABASE_URL`) | Everything but signing in |
| `admin_auth_role` | Admin app (`AUTH_DATABASE_URL`) | The login system only |

The migrations grant each login exactly what it needs. They assume the
logins already exist.

## Never use Neon's "Add role" screen

A role made there gets `BYPASSRLS` (through Neon's `neon_superuser`), which
silently removes the lock. Always make them with the SQL below, in Neon's
**SQL Editor**, connected as the database owner.

## The recipe

Make one strong password per login in Bitwarden first (32 random
characters). Never paste a password into chat; type it straight into the
SQL Editor and then into Vercel.

```sql
CREATE ROLE web_app_role LOGIN PASSWORD '<from Bitwarden>'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE web_auth_role LOGIN PASSWORD '<from Bitwarden>'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE admin_app_role LOGIN PASSWORD '<from Bitwarden>'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE admin_auth_role LOGIN PASSWORD '<from Bitwarden>'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
```

Then run the migrations (they grant the rights), and put each login's
connection string in the right Vercel project and setting (table above).

## Checking them

Every app checks its two logins each time it starts
(`apps/*/src/instrumentation.ts`). If either is a superuser, can bypass
row-level security or owns the tables, the app refuses to start and its
logs say which problem it found (never the login's name or password).

To check by hand in the SQL Editor:

```sql
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname IN ('web_app_role', 'web_auth_role', 'admin_app_role', 'admin_auth_role');
```

Every row must show `false`, `false`.

## Transactions must hold together

Each app also checks, as it starts, that a transaction really is one
transaction on its connection (`packages/db/src/transaction-check.ts`):
it opens one the way every tenant query does (`withTenant`, with a made-up
business id that no Operator has), runs four statements at once inside it,
and requires every one to report the same transaction and the business it
set. Nothing is read from or written to any table. If they don't all
match, the app refuses to start, and its logs say "does not keep a
transaction together" and what was wrong. A failure here means every
business's records rest on luck instead of the tenant lock: don't work
round it, find why (for example a database proxy that doesn't keep a
transaction on one connection, or a driver change).

The checks open their own short-lived connections and close them, so the
start-up code never makes the pool the pages run on.

Why it exists: from 5 to 11 Nov 2026 the dev site's start-up check made
the shared database pool with its own bundled copy of Neon's driver. The
pages' copy of Drizzle didn't recognise that pool, so it didn't hold each
transaction to one connection: statements went to whichever connection
was free, and a write after reads made at once could run with no business
set (the demo data stopped on "new row violates row-level security
policy for table bond_movements"). Pools are now kept per copy of the
driver (`packages/db/src/client.ts`), and
`packages/db/test/neon-driver-transactions.test.ts` runs Neon's real
driver through a local relay to prove both the failure and the fix.

## If a login was made on Neon's screen (it shows `t` above)

Neon won't let the database owner change such a login ("permission denied
to alter role"), so it is rebuilt instead. Done this way on the dev database
for `admin_auth_role` on 5 Nov 2026.

1. In the SQL Editor, take away what the migrations gave it: drop the
   policies `TO` that login and `REVOKE ALL` on its tables and on schema
   `public` (find them with `grep -n "<login>" packages/db/migrations/*.sql`).
2. Delete the login on Neon's **Roles** page.
3. Make it again with the recipe above, then run the same `GRANT` and
   `CREATE POLICY` lines from the migrations, in one transaction.
4. Put the new password in the login's connection string in Vercel, for
   every environment that uses it, and delete the query from the SQL
   Editor's History.
5. Run the check query above, adding
   `pg_has_role(rolname, 'neon_superuser', 'MEMBER')`: all `false`.
