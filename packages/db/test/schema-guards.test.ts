import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

import {
  ADMIN_APP_ROLE,
  NON_TENANT_TABLES,
  SELF_SCOPED_TENANT_TABLES,
  TENANT_ID_COLUMN,
  WEB_APP_ROLE,
} from "../src/tenancy";
import { connectAs, type TestConnection } from "./fixtures";

/**
 * Guards against the failure that matters most and is easiest to miss: a table
 * added in some future slice without tenant scoping on it.
 *
 * These read the live database rather than the schema files, so they catch a
 * table created by hand-written migration SQL just as readily as one declared
 * in Drizzle.
 */
describe("schema guards", () => {
  let owner: TestConnection;
  let tableNames: string[];

  beforeAll(async () => {
    owner = connectAs(inject("ownerUrl"));

    const result = await owner.db.execute<{ table_name: string }>(sql`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname
    `);
    tableNames = result.rows.map((row) => row.table_name);
  });

  afterAll(async () => {
    await owner.close();
  });

  it("found the tables to check", () => {
    expect(tableNames.length).toBeGreaterThan(0);
  });

  it("has row-level security enabled and forced on every table", async () => {
    const result = await owner.db.execute<{
      table_name: string;
      is_enabled: boolean;
      is_forced: boolean;
    }>(sql`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS is_enabled,
             c.relforcerowsecurity AS is_forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    `);

    const unprotected = result.rows.filter((row) => !row.is_enabled || !row.is_forced);

    expect(unprotected.map((row) => row.table_name)).toEqual([]);
  });

  it("has at least one policy on every table", async () => {
    const result = await owner.db.execute<{ table_name: string }>(sql`
      SELECT DISTINCT tablename AS table_name FROM pg_policies WHERE schemaname = 'public'
    `);
    const tablesWithPolicies = new Set(result.rows.map((row) => row.table_name));

    const withoutPolicies = tableNames.filter((name) => !tablesWithPolicies.has(name));

    expect(withoutPolicies).toEqual([]);
  });

  it("has a non-nullable operator_id on every tenant-owned table", async () => {
    const exempt = new Set<string>([...NON_TENANT_TABLES, ...SELF_SCOPED_TENANT_TABLES]);
    const expectedTables = tableNames.filter((name) => !exempt.has(name));

    const result = await owner.db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = ${TENANT_ID_COLUMN}
        AND is_nullable = 'NO'
    `);
    const scopedTables = new Set(result.rows.map((row) => row.table_name));

    const missing = expectedTables.filter((name) => !scopedTables.has(name));

    expect(missing).toEqual([]);
  });

  it("grants neither application role the right to delete a row", async () => {
    // The table owner holds DELETE implicitly and only ever runs migrations.
    // What matters is that neither running application can use it: core
    // records are archived, never hard-deleted (rule 13).
    const result = await owner.db.execute<{ table_name: string; grantee: string }>(sql`
      SELECT table_name, grantee
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND privilege_type = 'DELETE'
        AND grantee IN (${WEB_APP_ROLE}, ${ADMIN_APP_ROLE})
    `);

    expect(result.rows.map((row) => `${row.grantee} on ${row.table_name}`)).toEqual([]);
  });

  it("grants the web role nothing on the Admin table", async () => {
    const result = await owner.db.execute<{ privilege_type: string }>(sql`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'admin_users'
        AND grantee = ${WEB_APP_ROLE}
    `);

    expect(result.rows).toEqual([]);
  });

  it("runs the application roles without the power to bypass security", async () => {
    const result = await owner.db.execute<{ rolname: string }>(sql`
      SELECT rolname FROM pg_roles
      WHERE rolbypassrls AND rolname NOT LIKE 'pg\\_%' AND rolname <> 'postgres'
    `);

    expect(result.rows.map((row) => row.rolname)).toEqual([]);
  });
});
