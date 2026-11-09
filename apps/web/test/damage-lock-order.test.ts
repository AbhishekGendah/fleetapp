import { drawnSignatureInput } from "@fleetapp/core";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import type { EmailMessage } from "@fleetapp/email";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { createTemplate } from "../src/lib/contracts/templates";
import { confirmDamageRental, recordFoundDamage } from "../src/lib/damage/damage-records";
import { completeHandover } from "../src/lib/handover/complete-handover";
import { completeSwap, currentShownSwap } from "../src/lib/handover/complete-swap";
import { listChargeTypes } from "../src/lib/ledger/charge-types";
import { addCharge } from "../src/lib/ledger/ledger-records";
import { startSwap } from "../src/lib/rentals/car-swaps";
import { createMemoryFileStorage } from "../src/lib/storage/memory-file-storage";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, HANDOVER_KM, TEST_SIGNATURE } from "./handover-fixtures";
import {
  openTransactionAs,
  outcomeOf,
  outcomeWhileHeld,
  waitUntilBlockedBy,
} from "./lock-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The swap's new car starts at 12,000 km (addTestCar). */
const NEW_CAR_KM = 12_050;
const OLD_CAR_KM = HANDOVER_KM + 600;
const FOUND_ON = "2026-11-01";

/**
 * Damage recorded while the same rental is changed ("Lock order", lock
 * modes): adding a damage record, or pointing one at a rental, takes the car
 * and the rental "key shared" through their links, which a change of the
 * rental or the car never blocks (it locks them for no key update). Before
 * that, each of these deadlocked (40P01): the damage held the car shared
 * and waited for the rental, while the rental's change held the rental and
 * waited for the car.
 */
describe("damage recorded while its rental is changed", () => {
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
    actor = await seedOperatorWithUser(admin, "Damage Lock Order Rentals Pty Ltd");
    kit = checklistKit(web, createMemoryFileStorage(), sentEmails, actor);
    await createTemplate(web.db, actor, { kind: "swap_form", name: "Swap form" });
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.end()]);
  });

  const carOf = async (rentalId: string) =>
    (
      await superuser.query<{ vehicleId: string }>(
        `select vehicle_id as "vehicleId" from rentals where id = $1`,
        [rentalId],
      )
    ).rows[0]!.vehicleId;

  const foundDamage = (vehicleId: string, rentalId: string | null) =>
    recordFoundDamage(web.db, actor, vehicleId, {
      foundOn: FOUND_ON,
      description: "Dent in the rear door",
      x: null,
      y: null,
      rentalId,
    });

  /** Holds a checklist, as another signing at the same moment would. */
  async function holdChecklist(inspectionId: string) {
    const holder = await openTransactionAs(actor.operatorId);
    await holder.client.query("select id from inspections where id = $1 for update", [
      inspectionId,
    ]);
    return {
      pid: holder.pid,
      release: async () => {
        await holder.client.query("commit");
        await holder.client.end();
      },
    };
  }

  it("records damage on a car whose handover is being signed, holding its rental", async () => {
    const { rentalId } = await kit.readyRental();
    const inspectionId = await kit.filledHandover(rentalId);
    const shownFingerprint = await kit.shown(inspectionId);
    // Signing takes the rental (to number the report), then waits here for its checklist.
    const holder = await holdChecklist(inspectionId);
    const signed = outcomeOf(
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
    );
    await waitUntilBlockedBy(superuser, holder.pid);
    const found = outcomeOf(foundDamage(await carOf(rentalId), rentalId));
    const whileHeld = await outcomeWhileHeld(found, superuser, holder.pid, 2);
    await holder.release();

    expect({ whileHeld, found: await found, signed: await signed }).toEqual({
      whileHeld: "added",
      found: "added",
      signed: "completed",
    });
  });

  it("records damage on the old car of a swap being signed, holding its rental", async () => {
    const out = await kit.rentalOut(new Date(Date.now() - 2 * DAY_MS));
    const oldCarId = await carOf(out.rentalId);
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
    await kit.fillChecklist(swap.returnId, OLD_CAR_KM);
    await kit.fillChecklist(swap.handoverId, NEW_CAR_KM);
    const shown = await currentShownSwap(
      { database: web.db },
      actor.operatorId,
      out.rentalId,
      clock(),
    );
    // Signing takes the rental, the swap and the old car's checklist, then waits for the new car's.
    const holder = await holdChecklist(swap.handoverId);
    const signed = outcomeOf(
      completeSwap(
        kit.handoverDeps(),
        actor,
        out.rentalId,
        {
          shown: shown!,
          signature: drawnSignatureInput(TEST_SIGNATURE),
          oldCarAfter: { status: "available", statusReason: null, statusExpectedBack: null },
        },
        clock(),
      ),
    );
    await waitUntilBlockedBy(superuser, holder.pid);
    const found = outcomeOf(foundDamage(oldCarId, out.rentalId));
    const whileHeld = await outcomeWhileHeld(found, superuser, holder.pid, 2);
    await holder.release();

    expect({ whileHeld, found: await found, signed: await signed }).toEqual({
      whileHeld: "added",
      found: "added",
      signed: "completed",
    });
  });

  it("confirms who had the car while a charge for that damage is added to the rental", async () => {
    const out = await kit.rentalOut(new Date(Date.now() - 2 * DAY_MS));
    const vehicleId = await carOf(out.rentalId);
    const recorded = await foundDamage(vehicleId, null);
    const damageId = recorded.status === "added" ? recorded.damageId : "";
    const types = await listChargeTypes(web.db, actor.operatorId);
    const cleaningId = types.find((type) => type.label === "Cleaning")!.id;
    // The charge locks the rental, then its line's link to the charge type waits here,
    // before its link to the damage record.
    const holder = await openTransactionAs(actor.operatorId);
    await holder.client.query("select id from charge_types where id = $1 for update", [cleaningId]);
    const charged = outcomeOf(
      addCharge(web.db, actor, out.rentalId, {
        chargeTypeId: cleaningId,
        amountCents: 150_00,
        description: "Dent repaired",
        effectiveOn: FOUND_ON,
        damageRecordId: damageId,
      }),
    );
    await waitUntilBlockedBy(superuser, holder.pid);
    const confirmed = outcomeOf(
      confirmDamageRental(web.db, actor, damageId, out.rentalId).then((status) => ({ status })),
    );
    const whileHeld = await outcomeWhileHeld(confirmed, superuser, holder.pid, 2);
    await holder.client.query("commit");
    await holder.client.end();

    expect({ whileHeld, confirmed: await confirmed, charged: await charged }).toEqual({
      whileHeld: "changed",
      confirmed: "changed",
      charged: "saved",
    });
  });
});
