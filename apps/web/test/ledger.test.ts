import { drawnSignatureInput } from "@fleetapp/core";
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
import { waiveDailyRate } from "../src/lib/ledger/daily-rate-waiver";
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
 * Every moment is in 2030, well after any day the tests run, so each run
 * sees the same blocks. The test rentals are booked for four weeks (long-
 * term), $70 a day and $350 a week, and handed over at 10am in Perth.
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HANDOVER = new Date("2030-03-07T02:00:00Z");
const RETURN_KM = HANDOVER_KM + 300;

function afterHandover(days: number, extraMs = 0): Date {
  return new Date(HANDOVER.getTime() + days * DAY_MS + extraMs);
}

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
          periodStartsAt: ledgerLines.periodStartsAt,
          isCorrection: ledgerLines.isCorrection,
        })
        .from(ledgerLines)
        .where(
          and(eq(ledgerLines.operatorId, actor.operatorId), eq(ledgerLines.rentalId, rentalId)),
        )
        .orderBy(ledgerLines.periodStartsAt, ledgerLines.createdAt),
    );
  }

  async function balanceOf(rentalId: string): Promise<number> {
    return (await loadRentalLedger(web.db, actor.operatorId, rentalId)).balanceCents;
  }

  /** Records the car back at `returnedAt`, through the real return checklist. */
  async function returnAt(rentalId: string, returnedAt: Date): Promise<void> {
    const started = await startReturn(web.db, actor, rentalId);
    const returnId = "inspectionId" in started ? started.inspectionId : "";
    await kit.fillChecklist(returnId, RETURN_KM);
    const returned = await completeReturn(
      kit.handoverDeps(),
      actor,
      returnId,
      {
        returnedAt,
        signature: drawnSignatureInput(TEST_SIGNATURE),
        carAfter: { status: "available", statusReason: null, statusExpectedBack: null },
      },
      { timeZone: TEST_TIME_ZONE, now: returnedAt },
    );
    expect(returned.status).toBe("completed");
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
    // Set as the business sets it, in Settings (the admin app can't).
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .update(operators)
        .set({ gstRegistered: true, gstRegisteredFrom: "2020-01-01" })
        .where(eq(operators.id, actor.operatorId)),
    );
    const sentEmails: EmailMessage[] = [];
    kit = checklistKit(web, storage, sentEmails, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("charges a week at a time from the handover, never twice, and credits unused days", async () => {
    const { rentalId } = await kit.rentalOut(HANDOVER);

    await chargeRentFor(web.db, actor.operatorId, afterHandover(15));
    const again = await chargeRentFor(web.db, actor.operatorId, afterHandover(15), [rentalId]);

    expect(again).toEqual({ charged: 0, corrected: 0, failedRentals: 0 });
    expect(await rentLines(rentalId)).toEqual(
      [0, 7, 14].map((day) => ({
        kind: "charge",
        amountCents: 350_00,
        gstCents: 31_82,
        periodStartsAt: afterHandover(day),
        isCorrection: false,
      })),
    );
    expect(await balanceOf(rentalId)).toBe(1_050_00);

    // Back 16 days and 30 minutes in (inside the hour's grace): 16 days used,
    // so the third week keeps two days ($100) and five are credited.
    await returnAt(rentalId, afterHandover(16, 30 * 60 * 1000));
    await chargeRentFor(web.db, actor.operatorId, afterHandover(20));
    const afterReturn = await rentLines(rentalId);
    expect(afterReturn).toHaveLength(4);
    expect(afterReturn.at(-1)).toEqual({
      kind: "credit",
      amountCents: 250_00,
      gstCents: 22_73,
      periodStartsAt: afterHandover(14),
      isCorrection: true,
    });
    expect(await balanceOf(rentalId)).toBe(800_00);
  });

  it("costs exactly the four booked weeks when the car comes back on time (review A4-1)", async () => {
    const { rentalId } = await kit.rentalOut(HANDOVER);
    // The run reaches the fifth week the moment it starts, before the car is back.
    await chargeRentFor(web.db, actor.operatorId, afterHandover(28, 60_000));
    expect(await balanceOf(rentalId)).toBe(5 * 350_00);

    await returnAt(rentalId, afterHandover(28, 20 * 60 * 1000));

    expect(await balanceOf(rentalId)).toBe(4 * 350_00);
  });

  it("re-prices a long-term rental back before 7 days at the daily rate, until waived", async () => {
    const { rentalId } = await kit.rentalOut(HANDOVER);
    await chargeRentFor(web.db, actor.operatorId, afterHandover(0, 60_000), [rentalId]);
    await returnAt(rentalId, afterHandover(3));
    // Three days at $70, not three-sevenths of $350.
    expect(await balanceOf(rentalId)).toBe(210_00);

    expect(await waiveDailyRate(web.db, otherOperator, rentalId, "Not theirs")).toBe("not_found");
    expect(await waiveDailyRate(web.db, actor, rentalId, "Family emergency")).toBe("waived");
    expect(await waiveDailyRate(web.db, actor, rentalId, "Twice")).toBe("not_repriced");
    await chargeRentFor(web.db, actor.operatorId, afterHandover(4));

    expect(await balanceOf(rentalId)).toBe(150_00);
  });

  it("charges a signed rate from its rent week, and the weeks before at theirs", async () => {
    const { rentalId } = await kit.rentalOut(HANDOVER);
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx.insert(rentalRates).values({
        operatorId: actor.operatorId,
        rentalId,
        dailyRateCents: 70_00,
        weeklyRateCents: 420_00,
        appliesFromBlock: 7,
      }),
    );
    await chargeRentFor(web.db, actor.operatorId, afterHandover(8), [rentalId]);

    expect((await rentLines(rentalId)).map((line) => line.amountCents)).toEqual([350_00, 420_00]);
  });

  it("leaves a week alone once the business has waived it by reversing it (review A4-3)", async () => {
    const { rentalId } = await kit.rentalOut(HANDOVER);
    await chargeRentFor(web.db, actor.operatorId, afterHandover(0, 60_000), [rentalId]);
    const [week] = (await loadRentalLedger(web.db, actor.operatorId, rentalId)).lines;
    await reverseLine(
      web.db,
      actor,
      { rentalId, lineId: week!.id },
      { note: "First week free" },
      "2030-03-07",
    );

    await returnAt(rentalId, afterHandover(10));
    await chargeRentFor(web.db, actor.operatorId, afterHandover(11));

    // Week one stays free; week two is charged, then four of its days credited.
    expect(await balanceOf(rentalId)).toBe(150_00);
  });

  it("won't take a waiver it could not credit: rent reversed by hand (review of batch 1)", async () => {
    const { rentalId } = await kit.rentalOut(HANDOVER);
    await chargeRentFor(web.db, actor.operatorId, afterHandover(0, 60_000), [rentalId]);
    const [week] = (await loadRentalLedger(web.db, actor.operatorId, rentalId)).lines;
    await reverseLine(
      web.db,
      actor,
      { rentalId, lineId: week!.id },
      { note: "Charged wrongly" },
      "2030-03-07",
    );
    await returnAt(rentalId, afterHandover(3));

    expect(await waiveDailyRate(web.db, actor, rentalId, "Kind")).toBe("not_repriced");
  });

  it("takes GST from each type, adds payments, and corrects only by reversing a line once", async () => {
    const { rentalId } = await kit.rentalOut(HANDOVER);
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
      { note: "Toll was not this Renter's" },
      "2030-03-10",
    );
    const twice = await reverseLine(
      web.db,
      actor,
      { rentalId, lineId: tollLine.id },
      { note: "Again" },
      "2030-03-10",
    );
    expect(fixed.status).toBe("saved");
    expect(twice).toEqual({ status: "not_reversible" });
    expect((await loadRentalLedger(web.db, actor.operatorId, rentalId)).balanceCents).toBe(30_00);
  });

  it("keeps each business's ledger and charge types to itself", async () => {
    const { rentalId } = await kit.rentalOut(HANDOVER);
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

  // The run sweeps every business in the shared test database, so it runs at
  // the real time: a 2030 run would charge years of rent to other files'
  // rentals, slowly, while their own tests read them.
  it("the daily run visits every business with rent due, and adds nothing on a second run", async () => {
    const now = new Date();
    const first = await runRentJob(web.db, now);
    const second = await runRentJob(web.db, now);

    expect(first).toMatchObject({ failedOperators: 0 });
    expect(first.operators).toBeGreaterThan(0);
    expect(second).toMatchObject({ failedOperators: 0, done: 0 });
  });
});
