import { activityLog, operatorSettings } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { attentionList } from "../src/lib/dashboard/attention-items";
import { loadAttentionSources } from "../src/lib/dashboard/attention-sources";
import { MOST_OF_A_KIND } from "../src/lib/dashboard/fleet-overview";
import { loadOverdueRentals } from "../src/lib/dashboard/overdue-rentals";
import { listChargeTypes } from "../src/lib/ledger/charge-types";
import { addCharge, recordPayment } from "../src/lib/ledger/ledger-records";
import { cancelRental } from "../src/lib/rentals/rental-records";
import { chargeRentFor } from "../src/lib/ledger/rent-job";
import { numberSettingInputSchema } from "../src/lib/settings/number-setting-input";
import { loadOperatorSettings, saveOperatorSettings } from "../src/lib/settings/operator-settings";
import { createMemoryFileStorage } from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { checklistKit } from "./handover-fixtures";
import { addTestRenter, bookTestRental, TEST_TIME_ZONE } from "./rental-fixtures";

/**
 * Overdue in Needs attention (docs/plans/look-slice-2-overdue.md): worked
 * out from each rental's own ledger, one business at a time, and the grace
 * days setting that decides it. Every moment is in 2030, so each run sees
 * the same rent weeks: handed over at 10am Perth on Thu 7 Mar 2030, $350 a
 * week charged in advance.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const HANDOVER = new Date("2030-03-07T02:00:00Z");
const WEEK_CENTS = 350_00;
/** Two weeks charged (7 and 14 Mar), the second still inside two days' grace on the 16th. */
const TODAY = "2030-03-16";
const GRACE_DAYS = 2;

describe("overdue", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let operatorA: ActingUser;
  let operatorB: ActingUser;
  let rentalA = "";
  let rentalB = "";

  const overdueFor = (actor: ActingUser, graceDays = GRACE_DAYS) =>
    loadOverdueRentals(web.db, actor.operatorId, {
      today: TODAY,
      graceDays,
      limit: MOST_OF_A_KIND,
    });

  async function overdueRentalOf(actor: ActingUser): Promise<string> {
    const sentEmails: EmailMessage[] = [];
    const kit = checklistKit(web, createMemoryFileStorage(), sentEmails, actor);
    const { rentalId } = await kit.rentalOut(HANDOVER);
    await chargeRentFor(web.db, actor.operatorId, new Date(HANDOVER.getTime() + 8 * DAY_MS), [
      rentalId,
    ]);
    return rentalId;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    operatorA = await seedOperatorWithUser(admin, "Overdue A Rentals Pty Ltd");
    operatorB = await seedOperatorWithUser(admin, "Overdue B Rentals Pty Ltd");
    rentalA = await overdueRentalOf(operatorA);
    rentalB = await overdueRentalOf(operatorB);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("finds the rental owing past its grace, counting only the charges past it", async () => {
    const found = await overdueFor(operatorA);

    expect(found.total).toBe(1);
    expect(found.items[0]).toMatchObject({
      rentalId: rentalA,
      renterFullName: "Rory Ready",
      overdue: { overdueCents: WEEK_CENTS, daysLate: 9, oldestDueOn: "2030-03-07" },
    });
  });

  it("shows each business only its own overdue rentals (tenant isolation)", async () => {
    const seenByA = await overdueFor(operatorA);
    const seenByB = await overdueFor(operatorB);

    expect(seenByA.items.map((rental) => rental.rentalId)).toEqual([rentalA]);
    expect(seenByB.items.map((rental) => rental.rentalId)).toEqual([rentalB]);

    const clock = { timeZone: TEST_TIME_ZONE, now: new Date("2030-03-16T02:00:00Z") };
    const attentionOf = async (actor: ActingUser) =>
      attentionList(
        await loadAttentionSources(web.db, actor.operatorId, {
          clock,
          limitPerKind: MOST_OF_A_KIND,
        }),
        TEST_TIME_ZONE,
      ).items.filter((item) => item.kind === "overdue_payment");
    const [itemsOfA, itemsOfB] = [await attentionOf(operatorA), await attentionOf(operatorB)];
    expect(itemsOfA.map((item) => item.fix.href)).toEqual([`/rentals/${rentalA}?tab=money`]);
    expect(itemsOfB.map((item) => item.fix.href)).toEqual([`/rentals/${rentalB}?tab=money`]);
  });

  it("is gone once paid, and a part payment leaves only the rest overdue", async () => {
    const pay = (amountCents: number) =>
      recordPayment(web.db, operatorB, rentalB, {
        amountCents,
        method: "cash",
        reference: null,
        occurredOn: TODAY,
      });

    await pay(100_00);
    expect((await overdueFor(operatorB)).items[0]?.overdue.overdueCents).toBe(250_00);

    await pay(250_00);
    expect(await overdueFor(operatorB)).toEqual({ total: 0, items: [] });
  });

  it("saves the grace days setting, logs the change, and Needs attention follows it", async () => {
    expect((await loadOperatorSettings(web.db, operatorA.operatorId)).paymentGraceDays).toBe(
      GRACE_DAYS,
    );

    await saveOperatorSettings(web.db, operatorA, { paymentGraceDays: 10 });

    expect((await loadOperatorSettings(web.db, operatorA.operatorId)).paymentGraceDays).toBe(10);
    const history = await withTenant(web.db, operatorA.operatorId, (tx) =>
      tx
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.operatorId, operatorA.operatorId),
            eq(activityLog.entityType, "operator_settings"),
          ),
        ),
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      actorType: "user",
      action: "updated",
      valuesBefore: { paymentGraceDays: GRACE_DAYS },
      valuesAfter: { paymentGraceDays: 10 },
    });
    // Nine days late is inside ten days' grace.
    const settings = await loadOperatorSettings(web.db, operatorA.operatorId);
    expect(await overdueFor(operatorA, settings.paymentGraceDays)).toEqual({ total: 0, items: [] });
    // The other business keeps its own setting.
    const [otherRow] = await withTenant(web.db, operatorB.operatorId, (tx) =>
      tx
        .select()
        .from(operatorSettings)
        .where(eq(operatorSettings.operatorId, operatorB.operatorId)),
    );
    expect(otherRow?.settings ?? {}).not.toHaveProperty("paymentGraceDays");
  });

  it("counts a cancelled booking's unpaid fee, but not a cancelled booking that owes nothing", async () => {
    const operatorC = await seedOperatorWithUser(admin, "Overdue C Rentals Pty Ltd");
    const cancelBooking = async (): Promise<string> => {
      const renterId = await addTestRenter(web, operatorC, "Cass Cancelled");
      const { rentalId } = await bookTestRental(web, operatorC, renterId);
      await cancelRental(web.db, operatorC, rentalId, { reason: "Plans changed" }, new Date());
      return rentalId;
    };
    const withFee = await cancelBooking();
    await cancelBooking();
    const [feeType] = await listChargeTypes(web.db, operatorC.operatorId);
    const added = await addCharge(web.db, operatorC, withFee, {
      chargeTypeId: feeType!.id,
      amountCents: 100_00,
      description: "Cancellation fee",
      effectiveOn: "2030-03-07",
    });
    expect(added.status).toBe("saved");

    const found = await overdueFor(operatorC);

    expect(found.total).toBe(1);
    expect(found.items[0]).toMatchObject({
      rentalId: withFee,
      overdue: { overdueCents: 100_00, daysLate: 9 },
    });
  });

  it("never shows a cancelled booking whose fee is paid, or that is in credit", async () => {
    const operatorD = await seedOperatorWithUser(admin, "Overdue D Rentals Pty Ltd");
    const [feeType] = await listChargeTypes(web.db, operatorD.operatorId);
    const cancelledWith = async (paidCents: number): Promise<void> => {
      const renterId = await addTestRenter(web, operatorD, "Pat Paid");
      const { rentalId } = await bookTestRental(web, operatorD, renterId);
      await cancelRental(web.db, operatorD, rentalId, { reason: "Plans changed" }, new Date());
      await addCharge(web.db, operatorD, rentalId, {
        chargeTypeId: feeType!.id,
        amountCents: 100_00,
        description: "Cancellation fee",
        effectiveOn: "2030-03-07",
      });
      await recordPayment(web.db, operatorD, rentalId, {
        amountCents: paidCents,
        method: "cash",
        reference: null,
        occurredOn: "2030-03-08",
      });
    };
    await cancelledWith(100_00);
    await cancelledWith(150_00);

    expect(await overdueFor(operatorD)).toEqual({ total: 0, items: [] });
  });

  it("takes only a whole number of days from 0 to 30 in the box, checked again on the server", () => {
    const schema = numberSettingInputSchema("paymentGraceDays");

    expect(schema.safeParse({ amount: "0" }).data).toEqual({ amount: 0 });
    expect(schema.safeParse({ amount: " 30 " }).data).toEqual({ amount: 30 });
    for (const refused of ["", "31", "2.5", "-1", "two"]) {
      expect(schema.safeParse({ amount: refused }).success).toBe(false);
    }
  });
});
