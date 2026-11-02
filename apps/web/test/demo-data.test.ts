import { loadVehicleCatalogue } from "@fleetapp/db/vehicle-catalogue";
import { issuedDocuments, possessions, rentals, renters, vehicles } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { todayInTimeZone } from "@fleetapp/core";
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import type { DemoContext } from "../src/lib/demo-data/demo-context";
import { isDemoDataAllowedFor } from "../src/lib/demo-data/demo-gate";
import { DEMO_CAR_COUNT, DEMO_RENTALS, DEMO_RENTERS } from "../src/lib/demo-data/demo-plan";
import { DEMO_STEPS, runDemoStep } from "../src/lib/demo-data/demo-steps";
import { seedOperatorWithUser } from "./car-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";
import { linkTestKit } from "./renter-link-fixtures";

/** A whole demo run makes hundreds of records, PDFs and photos. */
const WHOLE_RUN_MS = 300_000;

describe("demo data", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherOperator: ActingUser;
  let context: DemoContext;

  async function runEveryStep(): Promise<number> {
    let added = 0;
    for (const step of DEMO_STEPS) {
      added += await runDemoStep(context, step.key);
    }
    return added;
  }

  function countOf(table: typeof vehicles | typeof renters | typeof rentals, operatorId: string) {
    return withTenant(web.db, operatorId, async (tx) => {
      const [row] = await tx
        .select({ total: count() })
        .from(table)
        .where(eq(table.operatorId, operatorId));
      return row?.total ?? 0;
    });
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Demo Data Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Demo Rentals Pty Ltd");
    const kit = linkTestKit(web, actor);
    context = {
      deps: { ...kit.fileDeps, emailSender: kit.linkDeps.emailSender },
      actor,
      timeZone: TEST_TIME_ZONE,
      today: todayInTimeZone(new Date(), TEST_TIME_ZONE),
      catalogue: await loadVehicleCatalogue(web.db),
      links: kit.linkDeps,
    };
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("is allowed only on a test site whose email stays in the test inbox", () => {
    expect(isDemoDataAllowedFor({ APP_STAGE: "development", EMAIL_TRANSPORT: "dev_outbox" })).toBe(
      true,
    );
    expect(isDemoDataAllowedFor({ APP_STAGE: undefined, EMAIL_TRANSPORT: "dev_outbox" })).toBe(
      true,
    );
    expect(isDemoDataAllowedFor({ APP_STAGE: "production", EMAIL_TRANSPORT: "dev_outbox" })).toBe(
      false,
    );
    expect(isDemoDataAllowedFor({ APP_STAGE: "development", EMAIL_TRANSPORT: "postmark" })).toBe(
      false,
    );
  });

  it(
    "fills the business with cars, Renters and rentals in every state, and adds nothing the second time",
    async () => {
      await runEveryStep();

      expect(await countOf(vehicles, actor.operatorId)).toBe(DEMO_CAR_COUNT);
      expect(await countOf(renters, actor.operatorId)).toBe(DEMO_RENTERS.length);
      expect(await countOf(rentals, actor.operatorId)).toBe(DEMO_RENTALS.length);
      const statuses = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ status: rentals.status, total: count() })
          .from(rentals)
          .where(eq(rentals.operatorId, actor.operatorId))
          .groupBy(rentals.status),
      );
      expect(Object.fromEntries(statuses.map((row) => [row.status, row.total]))).toEqual({
        active: 14,
        booked: 10,
        draft: 6,
        cancelled: 4,
      });
      const [handedOver] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ total: count() })
          .from(issuedDocuments)
          .where(
            and(
              eq(issuedDocuments.operatorId, actor.operatorId),
              eq(issuedDocuments.kind, "handover_report"),
            ),
          ),
      );
      const [held] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ total: count() })
          .from(possessions)
          .where(eq(possessions.operatorId, actor.operatorId)),
      );
      expect(handedOver?.total).toBe(14);
      expect(held?.total).toBe(14);

      expect(await runEveryStep()).toBe(0);
      expect(await countOf(vehicles, otherOperator.operatorId)).toBe(0);
    },
    WHOLE_RUN_MS,
  );
});
