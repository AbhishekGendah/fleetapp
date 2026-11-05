import { randomUUID } from "node:crypto";

import { drawnSignatureInput, todayInTimeZone, type TemplateDocument } from "@fleetapp/core";
import {
  carSwaps,
  inspectionDamageMarks,
  insurancePolicies,
  insurancePolicyVehicles,
  vehicles,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { loadContractData } from "../src/lib/contracts/contract-data";
import { createTemplate, saveTemplate } from "../src/lib/contracts/templates";
import { confirmDamageRental, recordFoundDamage } from "../src/lib/damage/damage-records";
import {
  completeSwap,
  currentShownSwap,
  loadSwapSigningView,
} from "../src/lib/handover/complete-swap";
import { addDamageMark, startHandover } from "../src/lib/handover/handover-records";
import { returnFormSchema } from "../src/lib/handover/return-input";
import { listChargeTypes } from "../src/lib/ledger/charge-types";
import { addCharge } from "../src/lib/ledger/ledger-records";
import { loadRentalLedger } from "../src/lib/ledger/ledger-queries";
import { startSwap } from "../src/lib/rentals/car-swaps";
import { listRentalPage } from "../src/lib/rentals/rental-queries";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, HANDOVER_KM, TEST_SIGNATURE } from "./handover-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

const HOUR_MS = 60 * 60 * 1000;
/** A VIN no other test car has: each car's VIN is its own. */
const uniqueVin = (): string =>
  `JTDBR32E72${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
const NEW_CAR_EXCESS_CENTS = 1_500_00;
const RENTAL_QUERY = {
  search: "",
  sort: { column: "start", direction: "asc" as const },
  filters: {},
  page: 1,
};

/** A swap form naming the car the Renter receives, as a business might write it. */
const SWAP_FORM: TemplateDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "You now have " },
        { type: "mergeField", attrs: { key: "carRego" } },
        { type: "text", text: ", VIN " },
        { type: "mergeField", attrs: { key: "carVin" } },
        { type: "text", text: ", excess " },
        { type: "mergeField", attrs: { key: "insuranceExcess" } },
      ],
    },
  ],
};

/** Batch 7, slice B: swaps and damage (review G4-3, A6-5, A6-7, A11-8, A11-9). */
describe("swaps and damage", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let actor: ActingUser;
  let kit: ReturnType<typeof checklistKit>;
  const sentEmails: EmailMessage[] = [];
  const clock = () => ({ timeZone: TEST_TIME_ZONE, now: new Date() });

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    actor = await seedOperatorWithUser(admin, "Swaps And Damage Rentals Pty Ltd");
    kit = checklistKit(web, storage, sentEmails, actor);
    const templateId = await createTemplate(web.db, actor, {
      kind: "swap_form",
      name: "Swap form",
    });
    await saveTemplate(web.db, actor, templateId, { name: "Swap form", content: SWAP_FORM });
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  /** A car with a VIN and a policy with an excess, started only this week. */
  async function newCarWithLaterPolicy(vin: string): Promise<string> {
    const vehicleId = await addTestCar(web, actor, { vin });
    await withTenant(web.db, actor.operatorId, async (tx) => {
      const [policy] = await tx
        .insert(insurancePolicies)
        .values({
          operatorId: actor.operatorId,
          insurer: "Later Insurer",
          policyNumber: randomUUID().slice(0, 8).toUpperCase(),
          coverType: "comprehensive",
          startsOn: todayInTimeZone(new Date(Date.now() - 24 * HOUR_MS), TEST_TIME_ZONE),
          endsOn: "2099-12-31",
          excessCents: NEW_CAR_EXCESS_CENTS,
          costCents: 0,
        })
        .returning({ id: insurancePolicies.id });
      await tx
        .insert(insurancePolicyVehicles)
        .values({ operatorId: actor.operatorId, policyId: policy!.id, vehicleId });
    });
    return vehicleId;
  }

  async function swapUnderWay(vin = uniqueVin()) {
    const out = await kit.rentalOut(new Date(Date.now() - 48 * HOUR_MS));
    const newCarId = await newCarWithLaterPolicy(vin);
    const started = await startSwap(
      web.db,
      actor,
      out.rentalId,
      { toVehicleId: newCarId, reason: "Engine light on" },
      clock(),
    );
    const swapId = "swapId" in started ? started.swapId : "";
    const [swap] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(carSwaps).where(eq(carSwaps.id, swapId)),
    );
    return { ...out, newCarId, swap: swap! };
  }

  async function swapDone() {
    const underWay = await swapUnderWay();
    await kit.fillChecklist(underWay.swap.returnInspectionId, HANDOVER_KM + 600);
    await kit.fillChecklist(underWay.swap.handoverInspectionId, 12_050);
    const shown = await currentShownSwap(
      { database: web.db },
      actor.operatorId,
      underWay.rentalId,
      clock(),
    );
    const result = await completeSwap(
      kit.handoverDeps(),
      actor,
      underWay.rentalId,
      {
        shown: shown!,
        signature: drawnSignatureInput(TEST_SIGNATURE),
        oldCarAfter: { status: "available", statusReason: null, statusExpectedBack: null },
      },
      clock(),
    );
    expect(result.status).toBe("completed");
    return underWay;
  }

  it("fills the swap form with the car the Renter receives, and its excess on the swap day", async () => {
    const vin = uniqueVin();
    const { rentalId } = await swapUnderWay(vin);

    const view = await loadSwapSigningView(
      { database: web.db },
      actor.operatorId,
      rentalId,
      clock(),
    );

    expect(view?.form.status).toBe("filled");
    const printed = view?.form.status === "filled" ? JSON.stringify(view.form.document) : "";
    expect(printed).toContain(vin);
    expect(printed).toContain("$1,500.00");
  });

  it("refuses to finish a swap onto a car sold since it began (batch 7 review)", async () => {
    const underWay = await swapUnderWay();
    await kit.fillChecklist(underWay.swap.returnInspectionId, HANDOVER_KM + 600);
    await kit.fillChecklist(underWay.swap.handoverInspectionId, 12_050);
    const shown = await currentShownSwap(
      { database: web.db },
      actor.operatorId,
      underWay.rentalId,
      clock(),
    );
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx.update(vehicles).set({ status: "sold" }).where(eq(vehicles.id, underWay.newCarId)),
    );

    const result = await completeSwap(
      kit.handoverDeps(),
      actor,
      underWay.rentalId,
      {
        shown: shown!,
        signature: drawnSignatureInput(TEST_SIGNATURE),
        oldCarAfter: { status: "available", statusReason: null, statusExpectedBack: null },
      },
      clock(),
    );

    expect(result).toEqual({ status: "new_car_changed" });
  });

  it("names the car each charge was for once the rental has been swapped", async () => {
    const { rentalId, vehicleId, newCarId } = await swapDone();
    const types = await listChargeTypes(web.db, actor.operatorId);
    await addCharge(web.db, actor, rentalId, {
      chargeTypeId: types.find((type) => type.label === "Cleaning")!.id,
      amountCents: 80_00,
      description: "Seats cleaned",
      effectiveOn: todayInTimeZone(new Date(), TEST_TIME_ZONE),
    });

    const ledger = await loadRentalLedger(web.db, actor.operatorId, rentalId);
    const regoOf = async (carId: string) => {
      const [car] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select({ rego: vehicles.rego }).from(vehicles).where(eq(vehicles.id, carId)),
      );
      return car!.rego;
    };
    const rent = ledger.lines.find((line) => line.description.startsWith("Rent"));
    const cleaning = ledger.lines.find((line) => line.description === "Seats cleaned");

    expect(rent?.rego).toBe(await regoOf(vehicleId));
    expect(cleaning?.rego).toBe(await regoOf(newCarId));
  });

  it("links damage on the car handed back to the Renter who had it, and keeps the rental on its tab", async () => {
    const { rentalId, vehicleId } = await swapDone();
    const added = await recordFoundDamage(web.db, actor, vehicleId, {
      x: null,
      y: null,
      rentalId: null,
      foundOn: todayInTimeZone(new Date(), TEST_TIME_ZONE),
      description: "Kerbed wheel",
    });
    const damageId = added.status === "added" ? added.damageId : "";

    const confirmed = await confirmDamageRental(web.db, actor, damageId, rentalId);
    const oldCarTab = await listRentalPage(web.db, actor.operatorId, RENTAL_QUERY, {
      clock: clock(),
      scope: { vehicleId },
    });

    expect(confirmed).toBe("changed");
    expect(oldCarTab.rows.map((rental) => rental.id)).toContain(rentalId);
  });

  it("saves a damage mark sent twice with the same phone key once (review A6-5)", async () => {
    const booked = await kit.readyRental();
    const started = await startHandover(web.db, actor, booked.rentalId);
    const inspectionId = "inspectionId" in started ? started.inspectionId : "";
    const markKey = randomUUID();
    const mark = { x: 400, y: 300, description: "Chip in windscreen" };

    const first = await addDamageMark(web.db, actor, inspectionId, mark, markKey);
    const again = await addDamageMark(web.db, actor, inspectionId, mark, markKey);
    const rows = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ id: inspectionDamageMarks.id })
        .from(inspectionDamageMarks)
        .where(eq(inspectionDamageMarks.inspectionId, inspectionId)),
    );

    expect(again).toEqual(first);
    expect(rows).toHaveLength(1);
  });

  it("puts the excess on the contract when the policy ends on the rental's first day (review A11-8)", async () => {
    const booked = await kit.readyRental({ isPaperworkOnFile: false });
    await withTenant(web.db, actor.operatorId, async (tx) => {
      const [policy] = await tx
        .insert(insurancePolicies)
        .values({
          operatorId: actor.operatorId,
          insurer: "Ending Insurer",
          policyNumber: randomUUID().slice(0, 8).toUpperCase(),
          coverType: "comprehensive",
          startsOn: "2026-06-01",
          // The test rental starts on 1 June 2027.
          endsOn: "2027-06-01",
          excessCents: 900_00,
          costCents: 0,
        })
        .returning({ id: insurancePolicies.id });
      await tx.insert(insurancePolicyVehicles).values({
        operatorId: actor.operatorId,
        policyId: policy!.id,
        vehicleId: booked.vehicleId,
      });
    });

    const data = await loadContractData(web.db, actor.operatorId, booked.rentalId, clock());

    expect(data?.insuranceExcess).toBe("$900.00");
  });
});

describe("a return time the clock shows twice (review A11-9)", () => {
  const SYDNEY = "Australia/Sydney";
  const values = {
    returnedAt: "2026-04-05T02:30",
    repeatedTime: "",
    isRenterPresent: "on",
    status: "available",
    statusReason: "",
    statusExpectedBack: "",
  };

  it("asks which one was meant, and keeps the one chosen", () => {
    const unchosen = returnFormSchema(SYDNEY).safeParse(values);
    const second = returnFormSchema(SYDNEY).safeParse({ ...values, repeatedTime: "second" });
    const first = returnFormSchema(SYDNEY).safeParse({ ...values, repeatedTime: "first" });

    expect(unchosen.success).toBe(false);
    expect(unchosen.error?.issues[0]?.path).toEqual(["repeatedTime"]);
    expect(second.data?.returnedAt.toISOString()).toBe("2026-04-04T16:30:00.000Z");
    expect(first.data?.returnedAt.toISOString()).toBe("2026-04-04T15:30:00.000Z");
  });

  it("says a skipped time didn't happen without naming how far the clocks moved", () => {
    const skipped = returnFormSchema("Australia/Lord_Howe").safeParse({
      ...values,
      returnedAt: "2026-10-04T02:15",
    });

    expect(skipped.error?.issues[0]?.message).toBe(
      "That time did not happen: the clocks went forward. Check the time.",
    );
  });
});
