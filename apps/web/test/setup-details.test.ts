import { getSetupChecklist } from "@fleetapp/core";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { createTemplate } from "../src/lib/contracts/templates";
import { loadSetupDetails } from "../src/lib/dashboard/load-setup-details";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { addTestRenter } from "./rental-fixtures";

/** The dashboard's setup steps, worked out from the business's own records only. */
describe("the setup checklist's records", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherOperator: ActingUser;

  async function statuses(operatorId: string) {
    const details = await loadSetupDetails(web.db, operatorId);
    return Object.fromEntries(getSetupChecklist(details!).map((step) => [step.key, step.status]));
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Setup Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Setup Rentals Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("ticks the contract once there is one, and cars and Renters once both exist", async () => {
    expect(await statuses(actor.operatorId)).toMatchObject({
      contract_template: "to_do",
      cars_and_renters: "to_do",
      stripe: "to_do",
    });

    await addTestCar(web, actor);
    expect((await statuses(actor.operatorId)).cars_and_renters).toBe("to_do");
    await addTestRenter(web, actor);
    await createTemplate(web.db, actor, { kind: "contract", name: "Our rental contract" });

    expect(await statuses(actor.operatorId)).toMatchObject({
      contract_template: "done",
      cars_and_renters: "done",
    });
  });

  it("counts only the business's own records", async () => {
    expect(await statuses(otherOperator.operatorId)).toMatchObject({
      contract_template: "to_do",
      cars_and_renters: "to_do",
    });
  });
});
