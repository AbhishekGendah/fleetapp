import { drawnSignatureInput } from "@fleetapp/core";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import type { EmailMessage } from "@fleetapp/email";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { createTemplate } from "../src/lib/contracts/templates";
import { completeHandover } from "../src/lib/handover/complete-handover";
import { completeReturn } from "../src/lib/handover/complete-return";
import { completeSwap, currentShownSwap } from "../src/lib/handover/complete-swap";
import { startReturn } from "../src/lib/handover/handover-records";
import { startSwap } from "../src/lib/rentals/car-swaps";
import { createMemoryFileStorage } from "../src/lib/storage/memory-file-storage";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, HANDOVER_KM, TEST_SIGNATURE } from "./handover-fixtures";
import {
  holdNextPhotoName,
  openTransactionAs,
  outcomeOf,
  waitUntilBlockedBy,
} from "./lock-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETURN_KM = HANDOVER_KM + 400;
/** The swap's new car starts at 12,000 km (addTestCar). */
const NEW_CAR_KM = 12_050;
const BACK_AVAILABLE = {
  status: "available" as const,
  statusReason: null,
  statusExpectedBack: null,
};

/** A checklist ready to sign, the car it is of, and what signing it as shown does. */
interface ReadyToSign {
  inspectionId: string;
  vehicleId: string;
  sign: () => Promise<{ status: string }>;
}

/**
 * A checklist photo started while its checklist is signed (second review of
 * slice 4): the upload holds the checklist (shared) before it locks the car
 * for the photo's name, in the order signing takes them, so neither holds
 * what the other waits for (a deadlock). Whichever comes second waits: a
 * photo after the signature is refused as the checklist is finished; one
 * before it is recorded and never joins the report (it isn't confirmed).
 */
describe("a checklist photo started while the checklist is signed", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: Client;
  let actor: ActingUser;
  let kit: ReturnType<typeof checklistKit>;
  const sentEmails: EmailMessage[] = [];
  const clock = () => ({ timeZone: TEST_TIME_ZONE, now: new Date() });

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    actor = await seedOperatorWithUser(admin, "Photo Lock Order Rentals Pty Ltd");
    kit = checklistKit(web, createMemoryFileStorage(), sentEmails, actor);
    await createTemplate(web.db, actor, { kind: "swap_form", name: "Swap form" });
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.end()]);
  });

  const vehicleOf = async (inspectionId: string) =>
    (
      await superuser.query<{ vehicleId: string }>(
        `select vehicle_id as "vehicleId" from inspections where id = $1`,
        [inspectionId],
      )
    ).rows[0]!.vehicleId;

  const checklists: Record<string, () => Promise<ReadyToSign>> = {
    "a handover": async () => {
      const { rentalId } = await kit.readyRental();
      const inspectionId = await kit.filledHandover(rentalId);
      const shownFingerprint = await kit.shown(inspectionId);
      return {
        inspectionId,
        vehicleId: await vehicleOf(inspectionId),
        sign: () =>
          completeHandover(
            kit.handoverDeps(),
            actor,
            inspectionId,
            {
              shownFingerprint,
              signature: drawnSignatureInput(TEST_SIGNATURE),
              bondOverrideReason: null,
              directDebitOverrideReason: null,
              insuranceOverrideReason: null,
              regoOverrideReason: null,
            },
            clock(),
          ),
      };
    },
    "a return": async () => {
      const out = await kit.rentalOut(new Date(Date.now() - 2 * DAY_MS));
      const started = await startReturn(web.db, actor, out.rentalId);
      const inspectionId = "inspectionId" in started ? started.inspectionId : "";
      await kit.fillChecklist(inspectionId, RETURN_KM);
      const shownFingerprint = await kit.shown(inspectionId);
      return {
        inspectionId,
        vehicleId: await vehicleOf(inspectionId),
        sign: () =>
          completeReturn(
            kit.handoverDeps(),
            actor,
            inspectionId,
            {
              shownFingerprint,
              returnedAt: new Date(),
              signature: drawnSignatureInput(TEST_SIGNATURE),
              carAfter: BACK_AVAILABLE,
            },
            clock(),
          ),
      };
    },
    "a swap's new car": async () => {
      const out = await kit.rentalOut(new Date(Date.now() - 2 * DAY_MS));
      const started = await startSwap(
        web.db,
        actor,
        out.rentalId,
        { toVehicleId: await addTestCar(web, actor), reason: "Engine light on" },
        clock(),
      );
      const swap = (
        await superuser.query<{ returnId: string; handoverId: string }>(
          `select return_inspection_id as "returnId", handover_inspection_id as "handoverId"
           from car_swaps where id = $1`,
          ["swapId" in started ? started.swapId : null],
        )
      ).rows[0]!;
      await kit.fillChecklist(swap.returnId, RETURN_KM);
      await kit.fillChecklist(swap.handoverId, NEW_CAR_KM);
      const shown = await currentShownSwap(
        { database: web.db },
        actor.operatorId,
        out.rentalId,
        clock(),
      );
      return {
        inspectionId: swap.handoverId,
        vehicleId: await vehicleOf(swap.handoverId),
        sign: () =>
          completeSwap(
            kit.handoverDeps(),
            actor,
            out.rentalId,
            {
              shown: shown!,
              signature: drawnSignatureInput(TEST_SIGNATURE),
              oldCarAfter: BACK_AVAILABLE,
            },
            clock(),
          ),
      };
    },
  };

  it.each(Object.keys(checklists))(
    "signs %s while a photo of it holds the car; the photo is recorded first",
    async (which) => {
      const ready = await checklists[which]!();
      // The upload locks the car for the photo's name, then waits on this name, holding the car.
      const name = await holdNextPhotoName({
        ...ready,
        operatorId: actor.operatorId,
        timeZone: TEST_TIME_ZONE,
      });
      const uploaded = outcomeOf(kit.startListedPhoto(ready.inspectionId));
      await waitUntilBlockedBy(superuser, name.pid);
      const signed = outcomeOf(ready.sign());
      await waitUntilBlockedBy(superuser, name.pid, 2);
      await name.release();

      expect(await uploaded).toBe("allowed");
      expect(await signed).toBe("completed");
    },
  );

  it.each(Object.keys(checklists))(
    "signs %s that reached its checklist first; the photo then waits",
    async (which) => {
      const ready = await checklists[which]!();
      // Holding the checklist: signing waits for it first, the upload behind it.
      const holder = await openTransactionAs(actor.operatorId);
      await holder.client.query("select id from inspections where id = $1 for update", [
        ready.inspectionId,
      ]);
      const signed = outcomeOf(ready.sign());
      await waitUntilBlockedBy(superuser, holder.pid);
      const uploaded = outcomeOf(kit.startListedPhoto(ready.inspectionId));
      await waitUntilBlockedBy(superuser, holder.pid, 2);
      await holder.client.query("commit");
      await holder.client.end();

      expect(await signed).toBe("completed");
      // Refused once the checklist is finished; recorded (never confirmed) if it got in just before.
      expect(["not_found", "allowed"]).toContain(await uploaded);
    },
  );
});
