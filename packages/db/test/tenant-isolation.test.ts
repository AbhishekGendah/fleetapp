import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";

/**
 * The test CLAUDE.md requires: proof that Operator A cannot read Operator B's
 * data. It runs as the real apps/web database role against the real policies,
 * so it fails if anyone weakens them.
 */
describe("tenant isolation", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;

  beforeAll(async () => {
    admin = connectAs(inject("adminRoleUrl"));
    // A single connection, so the "no context left behind" test below is
    // actually reusing the connection the transaction ran on.
    web = connectAs(inject("webRoleUrl"), { maxConnections: 1 });
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("shows an Operator only its own row", async () => {
    const rows = await withTenant(web.db, operatorAId, (tx) => tx.select().from(schema.operators));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(operatorAId);
  });

  it("hides another Operator's Users", async () => {
    const rows = await withTenant(web.db, operatorAId, (tx) => tx.select().from(schema.users));

    expect(rows).toHaveLength(1);
    expect(rows.every((row) => row.operatorId === operatorAId)).toBe(true);
  });

  it("hides another Operator's activity log", async () => {
    const rows = await withTenant(web.db, operatorAId, (tx) =>
      tx.select().from(schema.activityLog),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.operatorId).toBe(operatorAId);
  });

  it("returns nothing at all when no tenant context is set", async () => {
    const operatorRows = await web.db.select().from(schema.operators);
    const userRows = await web.db.select().from(schema.users);
    const logRows = await web.db.select().from(schema.activityLog);

    expect(operatorRows).toEqual([]);
    expect(userRows).toEqual([]);
    expect(logRows).toEqual([]);
  });

  it("refuses to write a row belonging to another Operator", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.activityLog).values({
          operatorId: operatorBId,
          actorType: "user",
          entityType: "operator",
          entityId: operatorBId,
          action: "created",
        }),
      ),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("refuses to move one of its own rows to another Operator", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.users)
          .set({ operatorId: operatorBId })
          .where(eq(schema.users.operatorId, operatorAId)),
      ),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("cannot touch the Admin table at all", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) => tx.select().from(schema.adminUsers)),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("leaves no tenant context behind on the connection", async () => {
    await withTenant(web.db, operatorAId, (tx) => tx.select().from(schema.operators));

    const rows = await web.db.select().from(schema.operators);

    expect(rows).toEqual([]);
  });
});
