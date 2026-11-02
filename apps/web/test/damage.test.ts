import { todayInTimeZone } from "@fleetapp/core";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import type { EmailMessage } from "@fleetapp/email";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { claimFormSchema, type ClaimInput } from "../src/lib/damage/damage-input";
import {
  loadDamageAttention,
  listCarDamage,
  listRentalDamage,
  loadClaimDefaults,
  loadDamageDetail,
  whoHadCar,
} from "../src/lib/damage/damage-queries";
import {
  archiveFoundDamage,
  changeDamageStatus,
  confirmDamageRental,
  recordFoundDamage,
  saveClaim,
} from "../src/lib/damage/damage-records";
import { completeReturn } from "../src/lib/handover/complete-return";
import { addDamageMark, startReturn } from "../src/lib/handover/handover-records";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { createPolicy } from "../src/lib/vehicles/insurance";
import { parsePolicyForm } from "../src/lib/vehicles/paperwork-input";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, HANDOVER_KM, TEST_SIGNATURE } from "./handover-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

const HOUR_MS = 60 * 60 * 1000;
const AVAILABLE = { status: "available" as const, statusReason: null, statusExpectedBack: null };
const LONG_AGO = "2026-01-05";
/** Before the test policy starts. */
const BEFORE_COVER = "2025-12-20";
const FOUND_FORM = { x: null, y: null, rentalId: null };

const CLAIM_FORM = {
  policyId: "",
  insurer: "Example Insurance",
  claimNumber: "",
  status: "not_lodged",
  excessCents: "",
  lodgedOn: "",
  settledOn: "",
  payoutCents: "",
  notes: "",
};

function claim(changes: Partial<typeof CLAIM_FORM> = {}): ClaimInput {
  const parsed = claimFormSchema.safeParse({ ...CLAIM_FORM, ...changes });
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data;
}

describe("the claim form's rules", () => {
  const problemsWith = (changes: Partial<typeof CLAIM_FORM>) => {
    const parsed = claimFormSchema.safeParse({ ...CLAIM_FORM, ...changes });
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
  };

  it("needs more as the claim gets further, and never a settled day before lodging", () => {
    expect(problemsWith({})).toEqual([]);
    expect(problemsWith({ status: "lodged" })).toEqual(["claimNumber", "lodgedOn"]);
    expect(
      problemsWith({ status: "paid", claimNumber: "C1", lodgedOn: "2026-10-10" }).sort(),
    ).toEqual(["payoutCents", "settledOn"]);
    expect(
      problemsWith({
        status: "declined",
        claimNumber: "C1",
        lodgedOn: "2026-10-10",
        settledOn: "2026-10-09",
      }),
    ).toEqual(["settledOn"]);
    expect(problemsWith({ excessCents: "-5" })).toEqual(["excessCents"]);
  });

  it("keeps amounts in whole cents and claim numbers in capitals", () => {
    expect(claim({ claimNumber: "ab-12", excessCents: "1,000.50" })).toMatchObject({
      claimNumber: "AB-12",
      excessCents: 1_000_50,
    });
  });
});

describe("damage records and insurance claims", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let actor: ActingUser;
  let otherOperator: ActingUser;
  let kit: ReturnType<typeof checklistKit>;

  const today = () => todayInTimeZone(new Date(), TEST_TIME_ZONE);
  const detail = (damageId: string, operatorId = actor.operatorId) =>
    loadDamageDetail(kit.deps(), operatorId, { damageId, timeZone: TEST_TIME_ZONE });

  /** A rental returned with one new dent marked and photographed. */
  async function returnedWithDent() {
    const out = await kit.rentalOut(new Date(Date.now() - 48 * HOUR_MS));
    const started = await startReturn(web.db, actor, out.rentalId);
    const inspectionId = "inspectionId" in started ? started.inspectionId : "";
    await kit.fillChecklist(inspectionId, HANDOVER_KM + 900);
    const mark = await addDamageMark(web.db, actor, inspectionId, {
      x: 300,
      y: 400,
      description: "Dent in rear door",
    });
    const markId = mark.status === "added" ? mark.markId : "";
    const photoId = await kit.takePhoto(inspectionId, { damageMarkId: markId });
    const finish = () =>
      completeReturn(
        kit.handoverDeps(),
        actor,
        inspectionId,
        { returnedAt: new Date(), drawnSignature: TEST_SIGNATURE, carAfter: AVAILABLE },
        { timeZone: TEST_TIME_ZONE, now: new Date() },
      );
    expect((await finish()).status).toBe("completed");
    expect(await finish()).toEqual({ status: "finished_already" });
    return { ...out, inspectionId, photoId };
  }

  async function foundDamage(vehicleId: string, rentalId: string | null = null) {
    const added = await recordFoundDamage(web.db, actor, vehicleId, {
      ...FOUND_FORM,
      foundOn: today(),
      description: "Scratch on bonnet",
      rentalId,
    });
    if (added.status !== "added") {
      throw new Error(`The damage was not added: ${added.status}`);
    }
    return added.damageId;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    const sentEmails: EmailMessage[] = [];
    actor = await seedOperatorWithUser(admin, "Damage Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Damage Rentals Pty Ltd");
    kit = checklistKit(web, storage, sentEmails, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("turns each new mark of a return into one open record, under that rental, with its photo", async () => {
    const { rentalId, vehicleId, photoId } = await returnedWithDent();

    const records = await listRentalDamage(web.db, actor.operatorId, rentalId);
    expect(records).toEqual([
      expect.objectContaining({
        vehicleId,
        foundOn: today(),
        description: "Dent in rear door",
        status: "open",
        claimStatus: null,
        isFromReturn: true,
      }),
    ]);
    expect(records[0]?.renterFullName).toBeTruthy();
    const shown = await detail(records[0]!.id);
    expect(shown?.record).toMatchObject({ x: 300, y: 400, rentalId });
    expect(shown?.photos.map((photo) => photo.id)).toEqual([photoId]);
    expect(shown?.suggestedHolder).toBeNull();
  });

  it("keeps a return's record: it cannot be archived or moved to another rental", async () => {
    const { rentalId } = await returnedWithDent();
    const [record] = await listRentalDamage(web.db, actor.operatorId, rentalId);
    const damageId = record!.id;

    expect(await archiveFoundDamage(web.db, actor, damageId)).toBe("not_found");
    expect(await confirmDamageRental(web.db, actor, damageId, null)).toBe("not_found");
    expect(
      await changeDamageStatus(web.db, actor, damageId, {
        status: "not_repairing",
        statusNote: "Cosmetic only",
      }),
    ).toBe("changed");
    expect((await detail(damageId))?.record).toMatchObject({
      status: "not_repairing",
      statusNote: "Cosmetic only",
      rentalId,
    });
  });

  it("suggests who had the car from possession, and lets the Operator confirm or clear it", async () => {
    const out = await kit.rentalOut(new Date(Date.now() - 24 * HOUR_MS));
    const holder = await whoHadCar(web.db, actor.operatorId, {
      vehicleId: out.vehicleId,
      day: today(),
      timeZone: TEST_TIME_ZONE,
    });
    const beforeRental = await whoHadCar(web.db, actor.operatorId, {
      vehicleId: out.vehicleId,
      day: LONG_AGO,
      timeZone: TEST_TIME_ZONE,
    });
    expect(holder?.rentalId).toBe(out.rentalId);
    expect(beforeRental).toBeNull();

    const damageId = await foundDamage(out.vehicleId);
    expect((await detail(damageId))?.suggestedHolder?.rentalId).toBe(out.rentalId);
    expect(await confirmDamageRental(web.db, actor, damageId, out.rentalId)).toBe("changed");
    const confirmed = await detail(damageId);
    expect(confirmed?.record.renterId).toBe(holder?.renterId);
    expect(confirmed?.suggestedHolder).toBeNull();
    expect(await confirmDamageRental(web.db, actor, damageId, null)).toBe("changed");
    expect((await detail(damageId))?.record.renterId).toBeNull();
  });

  it("refuses a rental of another car, and archives a record added by mistake", async () => {
    const out = await kit.rentalOut(new Date(Date.now() - 24 * HOUR_MS));
    const otherCar = await addTestCar(web, actor);

    const wrongRental = await recordFoundDamage(web.db, actor, otherCar, {
      ...FOUND_FORM,
      foundOn: today(),
      description: "Chip",
      rentalId: out.rentalId,
    });
    expect(wrongRental).toEqual({ status: "not_found" });

    const damageId = await foundDamage(otherCar);
    expect(await archiveFoundDamage(web.db, actor, damageId)).toBe("archived");
    expect(await detail(damageId)).toBeNull();
    expect(await listCarDamage(web.db, actor.operatorId, otherCar)).toEqual([]);
  });

  it("starts a claim from the car's policy that day, and tracks it through to paid", async () => {
    const carId = await addTestCar(web, actor);
    const parsedPolicy = parsePolicyForm({
      insurer: "Example Insurance",
      policyNumber: "DMG-1",
      coverType: "comprehensive",
      startsOn: "2026-01-01",
      endsOn: "2027-12-31",
      excessCents: "1,500",
      paymentFrequency: "yearly",
      costCents: "1,200",
      gstCents: "",
    });
    if (!parsedPolicy.success) {
      throw new Error(parsedPolicy.error.message);
    }
    const created = await createPolicy(web.db, actor, parsedPolicy.data, [carId]);
    const policyId = created.status === "created" ? created.policyId : "";
    const damageId = await foundDamage(carId);

    const defaults = await loadClaimDefaults(web.db, actor.operatorId, {
      vehicleId: carId,
      foundOn: today(),
      timeZone: TEST_TIME_ZONE,
    });
    expect(defaults).toEqual({ policyId, insurer: "Example Insurance", excessCents: 1_500_00 });
    expect(
      await loadClaimDefaults(web.db, actor.operatorId, {
        vehicleId: carId,
        foundOn: BEFORE_COVER,
        timeZone: TEST_TIME_ZONE,
      }),
    ).toBeNull();

    expect(
      await saveClaim(web.db, actor, damageId, claim({ policyId, excessCents: "1,500" })),
    ).toBe("saved");
    const lodgedForm = {
      policyId,
      status: "lodged",
      claimNumber: "clm-77",
      excessCents: "1,500",
      lodgedOn: today(),
    };
    expect(await saveClaim(web.db, actor, damageId, claim(lodgedForm))).toBe("saved");
    const underWay = (await loadDamageAttention(web.db, actor.operatorId)).claimsUnderWay.total;
    expect(underWay).toBeGreaterThanOrEqual(1);

    const paid = claim({
      ...lodgedForm,
      status: "paid",
      settledOn: today(),
      payoutCents: "2,340.50",
    });
    expect(await saveClaim(web.db, actor, damageId, paid)).toBe("saved");
    const shown = await detail(damageId);
    expect(shown?.claim).toMatchObject({
      claimNumber: "CLM-77",
      status: "paid",
      excessCents: 1_500_00,
      payoutCents: 2_340_50,
    });
    expect(shown?.claimPolicy).toEqual({ insurer: "Example Insurance", policyNumber: "DMG-1" });
    expect((await loadDamageAttention(web.db, actor.operatorId)).claimsUnderWay.total).toBe(
      underWay - 1,
    );
  });

  it("refuses a policy the car was never on", async () => {
    const carId = await addTestCar(web, actor);
    const otherCar = await addTestCar(web, actor);
    const parsedPolicy = parsePolicyForm({
      insurer: "Other Insurance",
      policyNumber: "DMG-2",
      coverType: "comprehensive",
      startsOn: "2026-01-01",
      endsOn: "2027-12-31",
      excessCents: "",
      paymentFrequency: "yearly",
      costCents: "900",
      gstCents: "",
    });
    if (!parsedPolicy.success) {
      throw new Error(parsedPolicy.error.message);
    }
    const created = await createPolicy(web.db, actor, parsedPolicy.data, [otherCar]);
    const policyId = created.status === "created" ? created.policyId : "";
    const damageId = await foundDamage(carId);

    expect(await saveClaim(web.db, actor, damageId, claim({ policyId }))).toBe("not_found");
    expect((await detail(damageId))?.claim).toBeNull();
  });

  it("keeps each business's damage to itself", async () => {
    const carId = await addTestCar(web, actor);
    const damageId = await foundDamage(carId);

    expect(await detail(damageId, otherOperator.operatorId)).toBeNull();
    expect(await listCarDamage(web.db, otherOperator.operatorId, carId)).toEqual([]);
    expect(
      await recordFoundDamage(web.db, otherOperator, carId, {
        ...FOUND_FORM,
        foundOn: today(),
        description: "Not theirs",
      }),
    ).toEqual({ status: "not_found" });
    expect(
      await changeDamageStatus(web.db, otherOperator, damageId, {
        status: "repaired",
        statusNote: null,
      }),
    ).toBe("not_found");
    expect(await saveClaim(web.db, otherOperator, damageId, claim())).toBe("not_found");
    expect(await archiveFoundDamage(web.db, otherOperator, damageId)).toBe("not_found");
    expect((await detail(damageId))?.record.status).toBe("open");
  });
});
