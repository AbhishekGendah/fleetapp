import { ledgerLines, operators, rentalRates } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { completeReturn } from "../src/lib/handover/complete-return";
import { startReturn } from "../src/lib/handover/handover-records";
import { addChargeType, listChargeTypes } from "../src/lib/ledger/charge-types";
import { loadRentalLedger } from "../src/lib/ledger/ledger-queries";
import { addCharge, recordPayment, reverseLine } from "../src/lib/ledger/ledger-records";
import { chargeRentFor, runRentJob } from "../src/lib/ledger/rent-job";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, HANDOVER_KM, TEST_SIGNATURE } from "./handover-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

/**
 * Every moment is in 2030, well after any day the tests run, and on Perth's
 * clock (UTC+8, no daylight saving), so each run sees the same periods. The
 * test rentals charge rent on Tuesdays.
 */
const HANDOVER_THURSDAY = new Date("2030-03-07T02:00:00Z");
const EARLY_WEDNESDAY_20TH = new Date("2030-03-19T17:00:00Z");
const RETURNED_THURSDAY_21ST = new Date("2030-03-21T07:00:00Z");
const EARLY_WEDNESDAY_27TH = new Date("2030-03-26T17:00:00Z");
const HANDOVER_TUESDAY_12TH = new Date("2030-03-12T02:00:00Z");
const WEDNESDAY_13TH = new Date("2030-03-13T04:00:00Z");
const RETURN_KM = HANDOVER_KM + 300;

describe("the ledger", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let actor: ActingUser;
  let otherOperator: ActingUser;
  let kit: ReturnType<typeof checklistKit>;

  async function rentLines(rentalId: string) {
    return withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({
          kind: ledgerLines.kind,
          amountCents: ledgerLines.amountCents,
          gstCents: ledgerLines.gstCents,
          periodStart: ledgerLines.periodStart,
        })
        .from(ledgerLines)
        .where(
          and(eq(ledgerLines.operatorId, actor.operatorId), eq(ledgerLines.rentalId, rentalId)),
        )
        .orderBy(ledgerLines.periodStart, ledgerLines.kind),
    );
  }

  async function typeId(label: string): Promise<string> {
    const types = await listChargeTypes(web.db, actor.operatorId);
    return types.find((type) => type.label === label)!.id;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    actor = await seedOperatorWithUser(admin, "Ledger Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Ledger Rentals Pty Ltd");
    await admin.db
      .update(operators)
      .set({ gstRegistered: true, gstRegisteredFrom: "2020-01-01" })
      .where(eq(operators.id, actor.operatorId));
    const sentEmails: EmailMessage[] = [];
    kit = checklistKit(web, storage, sentEmails, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("charges rent from the handover, a part week first, and never twice", async () => {
    const { rentalId } = await kit.rentalOut(HANDOVER_THURSDAY);

    await chargeRentFor(web.db, actor.operatorId, EARLY_WEDNESDAY_20TH);
    const again = await chargeRentFor(web.db, actor.operatorId, EARLY_WEDNESDAY_20TH, [rentalId]);

    expect(again).toEqual({ charged: 0, credited: 0 });
    expect(await rentLines(rentalId)).toEqual([
      // Thursday 7 to Monday 11: five days at $50, GST one-eleventh.
      { kind: "charge", amountCents: 250_00, gstCents: 22_73, periodStart: "2030-03-07" },
      { kind: "charge", amountCents: 350_00, gstCents: 31_82, periodStart: "2030-03-12" },
      { kind: "charge", amountCents: 350_00, gstCents: 31_82, periodStart: "2030-03-19" },
    ]);
    const ledger = await loadRentalLedger(web.db, actor.operatorId, rentalId);
    expect(ledger.balanceCents).toBe(950_00);
    expect(ledger.oldestOwingOn).toBe("2030-03-07");

    // Back on Thursday 21st: no rent for the 26th, and the four days after the return credited.
    const started = await startReturn(web.db, actor, rentalId);
    const returnId = "inspectionId" in started ? started.inspectionId : "";
    await kit.fillChecklist(returnId, RETURN_KM);
    const returned = await completeReturn(
      kit.handoverDeps(),
      actor,
      returnId,
      {
        returnedAt: RETURNED_THURSDAY_21ST,
        drawnSignature: TEST_SIGNATURE,
        carAfter: { status: "available", statusReason: null, statusExpectedBack: null },
      },
      { timeZone: TEST_TIME_ZONE, now: RETURNED_THURSDAY_21ST },
    );
    expect(returned.status).toBe("completed");
    await chargeRentFor(web.db, actor.operatorId, EARLY_WEDNESDAY_27TH);
    await chargeRentFor(web.db, actor.operatorId, EARLY_WEDNESDAY_27TH);
    const afterReturn = await rentLines(rentalId);
    expect(afterReturn).toHaveLength(4);
    expect(afterReturn).toContainEqual({
      kind: "credit",
      amountCents: 200_00,
      gstCents: 18_18,
      periodStart: "2030-03-19",
    });
    expect((await loadRentalLedger(web.db, actor.operatorId, rentalId)).balanceCents).toBe(750_00);
  });

  it("charges each day at the rate in force on it", async () => {
    const { rentalId } = await kit.rentalOut(HANDOVER_TUESDAY_12TH);
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx.insert(rentalRates).values({
        operatorId: actor.operatorId,
        rentalId,
        weeklyRateCents: 420_00,
        appliesFrom: "2030-03-14",
      }),
    );

    await chargeRentFor(web.db, actor.operatorId, WEDNESDAY_13TH, [rentalId]);

    // Tuesday and Wednesday at $50, Thursday to Monday at $60.
    expect((await rentLines(rentalId)).map((line) => line.amountCents)).toEqual([400_00]);
  });

  it("takes GST from each type, adds payments, and corrects only by reversing a line once", async () => {
    const { rentalId } = await kit.rentalOut(HANDOVER_THURSDAY);
    const tollTypeId = await addChargeType(web.db, actor, {
      name: "Bridge toll",
      gstTreatment: "gst_free",
    });
    const cleaning = await addCharge(web.db, actor, rentalId, {
      chargeTypeId: await typeId("Cleaning"),
      amountCents: 80_00,
      description: "Seats cleaned",
      effectiveOn: "2030-03-08",
    });
    const toll = await addCharge(web.db, actor, rentalId, {
      chargeTypeId: tollTypeId,
      amountCents: 12_50,
      description: "Tolls in March",
      effectiveOn: "2030-03-08",
    });
    const paid = await recordPayment(web.db, actor, rentalId, {
      amountCents: 50_00,
      method: "bank_transfer",
      reference: "ABC123",
      occurredOn: "2030-03-09",
    });
    expect([cleaning.status, toll.status, paid.status]).toEqual(["saved", "saved", "saved"]);
    const ledger = "ledger" in paid ? paid.ledger : null;
    expect(ledger?.lines.map((line) => [line.description, line.gstCents])).toEqual([
      ["Seats cleaned", 7_27],
      ["Tolls in March", 0],
      ["Payment received", 0],
    ]);
    expect(ledger?.balanceCents).toBe(80_00 + 12_50 - 50_00);

    const tollLine = ledger!.lines[1]!;
    const fixed = await reverseLine(
      web.db,
      actor,
      { rentalId, lineId: tollLine.id },
      { reason: "Toll was not this Renter's" },
      "2030-03-10",
    );
    const twice = await reverseLine(
      web.db,
      actor,
      { rentalId, lineId: tollLine.id },
      { reason: "Again" },
      "2030-03-10",
    );
    expect(fixed.status).toBe("saved");
    expect(twice).toEqual({ status: "not_reversible" });
    expect((await loadRentalLedger(web.db, actor.operatorId, rentalId)).balanceCents).toBe(30_00);
  });

  it("keeps each business's ledger and charge types to itself", async () => {
    const { rentalId } = await kit.rentalOut(HANDOVER_THURSDAY);
    const cleaningId = await typeId("Cleaning");

    const intoA = await addCharge(web.db, otherOperator, rentalId, {
      chargeTypeId: cleaningId,
      amountCents: 1_00,
      description: "Not mine",
      effectiveOn: "2030-03-08",
    });
    const paidIntoA = await recordPayment(web.db, otherOperator, rentalId, {
      amountCents: 1_00,
      method: "cash",
      reference: null,
      occurredOn: "2030-03-08",
    });
    const seenByOther = await loadRentalLedger(web.db, otherOperator.operatorId, rentalId);
    const othersTypes = await listChargeTypes(web.db, otherOperator.operatorId);

    expect([intoA.status, paidIntoA.status]).toEqual(["not_found", "not_found"]);
    expect(seenByOther.lines).toEqual([]);
    expect(othersTypes.map((type) => type.id)).not.toContain(cleaningId);
    expect(othersTypes.map((type) => type.label)).not.toContain("Bridge toll");
  });

  it("the daily run charges every business with rent due, and adds nothing on a second run", async () => {
    const first = await runRentJob(web.db, EARLY_WEDNESDAY_27TH);
    const second = await runRentJob(web.db, EARLY_WEDNESDAY_27TH);

    expect(first.failedOperators).toBe(0);
    expect(second).toMatchObject({ failedOperators: 0, done: 0 });
  });
});
