import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

import { InvalidOperatorIdError, withTenant } from "../src/tenant-context";
import { TENANT_SETTING_NAME } from "../src/tenancy";
import { connectAs, type TestConnection } from "./fixtures";

const AN_OPERATOR_ID = "00000000-0000-4000-8000-000000000001";

describe("withTenant", () => {
  let web: TestConnection;

  beforeAll(() => {
    web = connectAs(inject("webRoleUrl"), { maxConnections: 1 });
  });

  afterAll(async () => {
    await web.close();
  });

  it("makes the Operator id available inside the transaction", async () => {
    const setting = await withTenant(web.db, AN_OPERATOR_ID, async (tx) => {
      const result = await tx.execute<{ operator_id: string | null }>(
        sql`SELECT current_setting(${TENANT_SETTING_NAME}, true) AS operator_id`,
      );
      return result.rows[0]?.operator_id;
    });

    expect(setting).toBe(AN_OPERATOR_ID);
  });

  it("clears the Operator id once the transaction ends", async () => {
    await withTenant(web.db, AN_OPERATOR_ID, async () => undefined);

    const result = await web.db.execute<{ operator_id: string | null }>(
      sql`SELECT current_setting(${TENANT_SETTING_NAME}, true) AS operator_id`,
    );

    expect(result.rows[0]?.operator_id).toBeFalsy();
  });

  it("rolls the tenant context back with a failed transaction", async () => {
    await expect(
      withTenant(web.db, AN_OPERATOR_ID, async (tx) => {
        await tx.execute(sql`SELECT 1 / 0`);
      }),
    ).rejects.toThrow();

    const result = await web.db.execute<{ operator_id: string | null }>(
      sql`SELECT current_setting(${TENANT_SETTING_NAME}, true) AS operator_id`,
    );

    expect(result.rows[0]?.operator_id).toBeFalsy();
  });

  for (const badOperatorId of ["", "not-a-uuid", "1; DROP TABLE users"]) {
    it(`refuses to open a transaction for ${JSON.stringify(badOperatorId)}`, async () => {
      await expect(withTenant(web.db, badOperatorId, async () => undefined)).rejects.toBeInstanceOf(
        InvalidOperatorIdError,
      );
    });
  }
});
