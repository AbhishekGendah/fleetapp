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
