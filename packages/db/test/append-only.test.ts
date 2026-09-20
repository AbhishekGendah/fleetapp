import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

import * as schema from "../src/schema";
import { APPEND_ONLY_TABLES } from "../src/tenancy";
import {
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";

/**
 * Rule 19: the activity log is append-only. Proven against the database rather
 * than the application, so a mistake in application code — or a future data
 * migration run by the owner role — cannot quietly rewrite history.
 */
describe("append-only tables", () => {
  let admin: TestConnection;
  let owner: TestConnection;
  let superuser: TestConnection;
  let operatorAId: string;

  beforeAll(async () => {
    admin = connectAs(inject("adminRoleUrl"));
    owner = connectAs(inject("ownerUrl"));
    superuser = connectAs(inject("superuserUrl"));
    ({ operatorAId } = await seedTwoOperators(admin.db));
  });

  afterAll(async () => {
    await Promise.all([admin.close(), owner.close(), superuser.close()]);
  });

  it("has a blocking trigger on every table listed as append-only", async () => {
    const result = await owner.db.execute<{ table_name: string }>(sql`
      SELECT DISTINCT c.relname AS table_name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
    `);
    const tablesWithTriggers = new Set(result.rows.map((row) => row.table_name));

    const missing = APPEND_ONLY_TABLES.filter((name) => !tablesWithTriggers.has(name));

    expect(missing).toEqual([]);
  });

  it("gives the application no way to update a log row", async () => {
    const code = await postgresErrorCodeOf(
      admin.db
        .update(schema.activityLog)
        .set({ action: "tampered" })
        .where(eq(schema.activityLog.operatorId, operatorAId)),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("gives the application no way to delete a log row", async () => {
    const code = await postgresErrorCodeOf(
      admin.db.delete(schema.activityLog).where(eq(schema.activityLog.operatorId, operatorAId)),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  // The two above are stopped by the withheld grant, so they never reach the
  // trigger. These run as a superuser, which grants and row-level security do
  // not stop, to prove the trigger holds on its own — the situation that
  // arises the day someone grants UPDATE for a well-meaning reason.
  it("refuses an update even from a connection that grants do not stop", async () => {
    const code = await postgresErrorCodeOf(
      superuser.db
        .update(schema.activityLog)
        .set({ action: "tampered" })
        .where(eq(schema.activityLog.operatorId, operatorAId)),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.restrictViolation);
  });

  it("refuses a delete even from a connection that grants do not stop", async () => {
    const code = await postgresErrorCodeOf(
      superuser.db.delete(schema.activityLog).where(eq(schema.activityLog.operatorId, operatorAId)),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.restrictViolation);
  });

  it("still accepts new log rows", async () => {
    await expect(
      admin.db.insert(schema.activityLog).values({
        operatorId: operatorAId,
        actorType: "system",
        entityType: "operator",
        entityId: operatorAId,
        action: "checked",
      }),
    ).resolves.toBeDefined();
  });
});
