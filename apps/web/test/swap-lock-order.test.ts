import { drawnSignatureInput } from "@fleetapp/core";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import type { EmailMessage } from "@fleetapp/email";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { createTemplate } from "../src/lib/contracts/templates";
import { completeSwap, currentShownSwap } from "../src/lib/handover/complete-swap";
import { cancelSwap, startSwap } from "../src/lib/rentals/car-swaps";
import { createMemoryFileStorage } from "../src/lib/storage/memory-file-storage";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, HANDOVER_KM, TEST_SIGNATURE } from "./handover-fixtures";
import { openTransactionAs, waitUntilBlockedBy } from "./lock-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The new car starts at 12,000 km (addTestCar); the old car went out at the handover's. */
const NEW_CAR_KM = 12_050;
const OLD_CAR_KM = HANDOVER_KM + 600;
const TO_WORKSHOP = {
  status: "in_service" as const,
  statusReason: "Gearbox",
  statusExpectedBack: "2027-12-01",
};

/**
 * Cancelling a car swap while it is being signed (review, 8 Nov 2026): both
 * lock the rental, then the swap, then its two checklists, so one waits for
 * the other rather than each holding what the other needs (a deadlock), and
 * the one that waited finds the other's result.
 */
describe("cancelling a car swap while it is signed", () => {
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
    actor = await seedOperatorWithUser(admin, "Swap Lock Order Rentals Pty Ltd");
    kit = checklistKit(web, createMemoryFileStorage(), sentEmails, actor);
    await createTemplate(web.db, actor, { kind: "swap_form", name: "Swap form" });
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.end()]);
  });

  /** A swap with both checklists filled, and what signing it as shown does. */
  async function swapReadyToSign() {
    const out = await kit.rentalOut(new Date(Date.now() - 2 * DAY_MS));
    const started = await startSwap(
      web.db,
      actor,
      out.rentalId,
      { toVehicleId: await addTestCar(web, actor), reason: "Engine light on" },
      clock(),
    );
    if (!("swapId" in started)) {
      throw new Error(`The test swap did not start: ${started.status}`);
    }
    const swap = (
      await superuser.query<{ returnId: string; handoverId: string }>(
        `select return_inspection_id as "returnId", handover_inspection_id as "handoverId"
         from car_swaps where id = $1`,
        [started.swapId],
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
    const sign = () =>
      completeSwap(
        kit.handoverDeps(),
        actor,
        out.rentalId,
        { shown: shown!, signature: drawnSignatureInput(TEST_SIGNATURE), oldCarAfter: TO_WORKSHOP },
        clock(),
      );
    return { rentalId: out.rentalId, swapId: started.swapId, ...swap, sign };
  }

  const statusOf = async (table: "car_swaps" | "inspections", id: string) =>
    (await superuser.query<{ status: string }>(`select status from ${table} where id = $1`, [id]))
      .rows[0]?.status;

  it("finishes the signing that reached the rental first; the cancel is then refused", async () => {
    const swap = await swapReadyToSign();
    // Holding the new car's checklist: signing takes the rental, the swap and the old car's, then waits here.
    const holder = await openTransactionAs(actor.operatorId);
    await holder.client.query("select id from inspections where id = $1 for update", [
      swap.handoverId,
    ]);
    const signed = swap.sign();
    await waitUntilBlockedBy(superuser, holder.pid);
    const cancelled = cancelSwap(web.db, actor, swap.rentalId);
    // The cancel waits for signing's lock on the rental, holding nothing signing needs.
    await waitUntilBlockedBy(superuser, holder.pid, 2);
    await holder.client.query("commit");
    await holder.client.end();

    expect((await signed).status).toBe("completed");
    expect(await cancelled).toBe("finished_already");
    expect(await statusOf("car_swaps", swap.swapId)).toBe("completed");
    expect(await statusOf("inspections", swap.returnId)).toBe("completed");
    expect(await statusOf("inspections", swap.handoverId)).toBe("completed");
  });

  it("cancels the swap that reached the rental first; signing is then refused as finished", async () => {
    const swap = await swapReadyToSign();
    // Holding the rental: the cancel queues for it first, signing after it.
    const holder = await openTransactionAs(actor.operatorId);
    await holder.client.query("select id from rentals where id = $1 for update", [swap.rentalId]);
    const cancelled = cancelSwap(web.db, actor, swap.rentalId);
    await waitUntilBlockedBy(superuser, holder.pid);
    const signed = swap.sign();
    await waitUntilBlockedBy(superuser, holder.pid, 2);
    await holder.client.query("commit");
    await holder.client.end();

    expect(await cancelled).toBe("cancelled");
    expect(await signed).toEqual({ status: "finished_already" });
    expect(await statusOf("car_swaps", swap.swapId)).toBe("cancelled");
    expect(await statusOf("inspections", swap.returnId)).toBe("cancelled");
    expect(await statusOf("inspections", swap.handoverId)).toBe("cancelled");
  });
});
