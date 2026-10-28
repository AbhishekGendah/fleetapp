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

/** Operator settings stay within their Operator, and admin can only look. */
describe("Operator settings isolation", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));

    for (const operatorId of [operatorAId, operatorBId]) {
      await withTenant(web.db, operatorId, (tx) =>
        tx.insert(schema.operatorSettings).values({ operatorId, settings: { owner: operatorId } }),
      );
    }
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("shows an Operator only its own settings", async () => {
    const rows = await withTenant(web.db, operatorAId, (tx) =>
      tx.select().from(schema.operatorSettings),
    );

    expect(rows.map((row) => row.operatorId)).toEqual([operatorAId]);
  });

  it("cannot change another Operator's settings", async () => {
    await withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.operatorSettings)
        .set({ settings: { owner: "someone else" } })
        .where(eq(schema.operatorSettings.operatorId, operatorBId)),
    );

    const [operatorB] = await admin.db
      .select()
      .from(schema.operatorSettings)
      .where(eq(schema.operatorSettings.operatorId, operatorBId));
    expect(operatorB?.settings).toEqual({ owner: operatorBId });
  });

  it("cannot create settings for another Operator", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.operatorSettings).values({ operatorId: operatorBId }),
      ),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("lets the admin app read settings but not change them", async () => {
    const rows = await admin.db.select().from(schema.operatorSettings);
    const code = await postgresErrorCodeOf(
      admin.db.update(schema.operatorSettings).set({ settings: {} }),
    );

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });
});
