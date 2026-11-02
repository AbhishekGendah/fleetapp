import {
  carSwaps,
  damageRecords,
  insuranceClaims,
  issuedDocuments,
  possessions,
  rentalChanges,
  rentals,
  renters,
  vehicles,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import type { DemoContext } from "../src/lib/demo-data/demo-context";
import { isDemoDataAllowedFor } from "../src/lib/demo-data/demo-gate";
import { DEMO_CAR_COUNT, DEMO_RENTALS, DEMO_RENTERS } from "../src/lib/demo-data/demo-plan";
import { seedOperatorWithUser } from "./car-fixtures";
import { demoTestContext, runEveryDemoStep, WHOLE_DEMO_RUN_MS } from "./demo-fixtures";

describe("demo data", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherOperator: ActingUser;
  let context: DemoContext;

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
    context = await demoTestContext(web, actor);
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
      await runEveryDemoStep(context);

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
        returned: 3,
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
      // 17 handovers, plus the car swap's handover of the new car.
      expect(handedOver?.total).toBe(18);
      expect(held?.total).toBe(18);
      const swaps = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ status: carSwaps.status })
          .from(carSwaps)
          .where(eq(carSwaps.operatorId, actor.operatorId)),
      );
      expect(swaps).toEqual([{ status: "completed" }]);
      const damage = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ status: damageRecords.status, claimStatus: insuranceClaims.status })
          .from(damageRecords)
          .leftJoin(insuranceClaims, eq(insuranceClaims.damageRecordId, damageRecords.id))
          .where(eq(damageRecords.operatorId, actor.operatorId)),
      );
      expect(damage).toHaveLength(5);
      const changes = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ kind: rentalChanges.kind, status: rentalChanges.status })
          .from(rentalChanges)
          .where(eq(rentalChanges.operatorId, actor.operatorId)),
      );
      expect(changes.map((change) => `${change.kind}:${change.status}`).sort()).toEqual([
        "end_date:applied",
        "weekly_rate:waiting_for_signature",
      ]);
      expect(damage.map((record) => record.claimStatus ?? "none").sort()).toEqual([
        "declined",
        "lodged",
        "none",
        "none",
        "paid",
      ]);

      expect(await runEveryDemoStep(context)).toBe(0);
      expect(await countOf(vehicles, otherOperator.operatorId)).toBe(0);
    },
    WHOLE_DEMO_RUN_MS,
  );
});
