import { drawnSignatureInput } from "@fleetapp/core";
import { carHolds, issuedDocuments, possessions, rentals, vehicles } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { completeReturn, type CompleteReturnInput } from "../src/lib/handover/complete-return";
import { loadReturn } from "../src/lib/handover/handover-queries";
import { addDamageMark, startReturn } from "../src/lib/handover/handover-records";
import { saveOperatorSettings } from "../src/lib/settings/operator-settings";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, HANDOVER_KM, TEST_SIGNATURE } from "./handover-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

const HOUR_MS = 60 * 60 * 1000;
const RETURN_KM = HANDOVER_KM + 1_820;
const AVAILABLE = { status: "available" as const, statusReason: null, statusExpectedBack: null };

describe("taking a car back", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let sentEmails: EmailMessage[];
  let actor: ActingUser;
  let otherOperator: ActingUser;
  let kit: ReturnType<typeof checklistKit>;

  const clock = () => ({ timeZone: TEST_TIME_ZONE, now: new Date() });
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR_MS);

  /** A rental out since `handedOverAt`, with its return checklist filled in. */
  async function filledReturn(handedOverAt = hoursAgo(72)) {
    const out = await kit.rentalOut(handedOverAt);
    const started = await startReturn(web.db, actor, out.rentalId);
    const inspectionId = "inspectionId" in started ? started.inspectionId : "";
    await kit.fillChecklist(inspectionId, RETURN_KM);
    return { ...out, inspectionId };
  }

  async function finish(inspectionId: string, input: Partial<CompleteReturnInput> = {}) {
    return completeReturn(
      kit.handoverDeps(),
      actor,
      inspectionId,
      {
        shownFingerprint: await kit.shown(inspectionId),
        returnedAt: new Date(),
        signature: drawnSignatureInput(TEST_SIGNATURE),
        carAfter: AVAILABLE,
        ...input,
      },
      clock(),
    );
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    sentEmails = [];
    actor = await seedOperatorWithUser(admin, "Return Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Return Rentals Pty Ltd");
    kit = checklistKit(web, storage, sentEmails, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("starts only once the car is out, asks for the handover's photos, and is the Operator's own", async () => {
    const booked = await kit.readyRental();
    expect((await startReturn(web.db, actor, booked.rentalId)).status).toBe("not_booked");

    const { inspectionId } = await filledReturn();
    const view = await loadReturn(web.db, actor.operatorId, inspectionId);
    expect(view?.kind).toBe("return");
    expect(view?.photoNames).toHaveLength(8);
    expect(view?.gaps).toEqual([]);
    expect(await loadReturn(web.db, otherOperator.operatorId, inspectionId)).toBeNull();
  });

  it("refuses a return time before the handover or in the future, and needs a photo of new damage", async () => {
    const handedOverAt = hoursAgo(48);
    const { inspectionId } = await filledReturn(handedOverAt);

    const beforeHandover = await finish(inspectionId, { returnedAt: hoursAgo(49) });
    const inFuture = await finish(inspectionId, { returnedAt: new Date(Date.now() + HOUR_MS) });
    await addDamageMark(web.db, actor, inspectionId, { x: 500, y: 920, description: "Dent" });
    const withoutPhoto = await finish(inspectionId);

    expect(beforeHandover).toEqual({ status: "return_time", problem: "before_handover" });
    expect(inFuture).toEqual({ status: "return_time", problem: "in_future" });
    expect(withoutPhoto).toEqual({ status: "gaps", gaps: [{ kind: "damage_photo" }] });
  });

  it("takes the car back: report fixed, possession ended, rental returned, car free, kilometres, copies", async () => {
    const { rentalId, vehicleId, inspectionId } = await filledReturn();
    const returnedAt = hoursAgo(2);
    sentEmails.length = 0;

    const result = await finish(inspectionId, { returnedAt });
    const again = await finish(inspectionId);

    expect(result.status).toBe("completed");
    expect(again).toEqual({ status: "finished_already" });
    await withTenant(web.db, actor.operatorId, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, rentalId));
      const [possession] = await tx
        .select()
        .from(possessions)
        .where(eq(possessions.rentalId, rentalId));
      const [car] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId));
      const liveHolds = await tx
        .select()
        .from(carHolds)
        .where(and(eq(carHolds.rentalId, rentalId), isNull(carHolds.releasedAt)));
      const reports = await tx
        .select()
        .from(issuedDocuments)
        .where(
          and(eq(issuedDocuments.rentalId, rentalId), eq(issuedDocuments.kind, "return_report")),
        );
      expect(rental?.status).toBe("returned");
      expect(rental?.returnedAt).toEqual(returnedAt);
      expect(possession?.endedAt).toEqual(returnedAt);
      expect(possession?.returnInspectionId).toBe(inspectionId);
      expect(car?.status).toBe("available");
      expect(liveHolds).toEqual([]);
      expect(reports).toHaveLength(1);
    });
    // The test business has no email on file, so only the Renter's copy goes. The
    // long-term booking came back after two days, so its rent is re-priced at the
    // daily rate and the difference credited with its own note.
    expect(sentEmails.map((email) => email.subject).sort()).toEqual([
      expect.stringMatching(/^Credit note /),
      expect.stringMatching(/^Your car return report from /),
    ]);
    const reportEmail = sentEmails.find((email) => email.subject.startsWith("Your car return"));
    expect(reportEmail?.attachments?.[0]?.fileName).toMatch(/^Return report .*\.pdf$/);
  });

  it("records the Renter as not there, unless the rental's settings need their signature", async () => {
    const first = await filledReturn();
    expect((await finish(first.inspectionId, { signature: null })).status).toBe("completed");

    await saveOperatorSettings(web.db, actor, { isRenterSignatureAtReturnRequired: true });
    const second = await filledReturn();
    expect(await finish(second.inspectionId, { signature: null })).toEqual({
      status: "signature_required",
    });
  });

  it("can send the car to the workshop instead, but never mark it sold from a return", async () => {
    const { vehicleId, inspectionId } = await filledReturn();
    const sold = await finish(inspectionId, {
      carAfter: { status: "sold", statusReason: null, statusExpectedBack: null },
    });
    const toWorkshop = await finish(inspectionId, {
      carAfter: { status: "in_service", statusReason: "Brakes", statusExpectedBack: "2027-01-10" },
    });

    expect(sold).toEqual({ status: "car_status" });
    expect(toWorkshop.status).toBe("completed");
    const [car] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)),
    );
    expect(car?.status).toBe("in_service");
  });

  it("refuses another Operator's return", async () => {
    const { inspectionId } = await filledReturn();
    const result = await completeReturn(
      kit.handoverDeps(),
      otherOperator,
      inspectionId,
      {
        shownFingerprint: await kit.shown(inspectionId),
        returnedAt: new Date(),
        signature: drawnSignatureInput(TEST_SIGNATURE),
        carAfter: AVAILABLE,
      },
      clock(),
    );
    expect(result).toEqual({ status: "not_found" });
  });
});
