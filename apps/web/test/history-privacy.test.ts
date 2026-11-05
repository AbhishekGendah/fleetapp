import type { ListQuery } from "@fleetapp/core";
import { activityLog } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { listChargeTypes } from "../src/lib/ledger/charge-types";
import { saveOperatorSettings } from "../src/lib/settings/operator-settings";
import { exportVehicles } from "../src/lib/vehicles/vehicle-queries";
import { seedOperatorWithUser } from "./car-fixtures";

const ALL_CARS: ListQuery = {
  search: "",
  sort: { column: "rego", direction: "asc" },
  filters: {},
  page: 1,
};

/** What the business's history keeps, and what it leaves out (review A8-8). */
describe("the business's history", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;

  const historyOf = (entityType: string) =>
    withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select()
        .from(activityLog)
        .where(
          and(eq(activityLog.operatorId, actor.operatorId), eq(activityLog.entityType, entityType)),
        ),
    );

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "History Rentals Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("says How to pay changed, never the bank details", async () => {
    const bankDetails = "BSB 062-000, account 1234 5678";
    await saveOperatorSettings(web.db, actor, { howToPay: bankDetails });

    const lines = await historyOf("operator_settings");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.valuesAfter).toHaveProperty("howToPay");
    expect(JSON.stringify(lines)).not.toContain("1234 5678");
  });

  it("logs a download of the cars list, without its rows", async () => {
    await exportVehicles(web.db, actor, ALL_CARS, "csv");

    const lines = (await historyOf("operator")).filter((line) => line.action === "exported");
    expect(lines.map((line) => line.valuesAfter)).toEqual([
      { list: "cars", format: "csv", rows: 0 },
    ]);
  });

  it("logs each built-in charge type once, when it is first made", async () => {
    const types = await listChargeTypes(web.db, actor.operatorId);
    await listChargeTypes(web.db, actor.operatorId);

    const lines = await historyOf("charge_type");
    const builtIn = types.filter((type) => type.builtIn !== null);
    expect(lines).toHaveLength(builtIn.length);
    expect(lines.every((line) => line.actorType === "system" && line.action === "created")).toBe(
      true,
    );
  });
});
