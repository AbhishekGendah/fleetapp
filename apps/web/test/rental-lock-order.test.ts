import { drawnSignatureInput } from "@fleetapp/core";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import type { EmailMessage } from "@fleetapp/email";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { completeHandover } from "../src/lib/handover/complete-handover";
import { cancelRental } from "../src/lib/rentals/rental-records";
import { createMemoryFileStorage } from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, TEST_SIGNATURE } from "./handover-fixtures";
import { openTransactionAs, waitUntilBlockedBy } from "./lock-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

const CANCEL_REASON = { reason: "Renter changed their plans" };

/**
 * Cancelling a booking and finishing its handover at the same moment
 * (review, 8 Nov 2026): both lock the rental before its checklist, so one
 * waits for the other rather than each holding what the other needs (a
 * deadlock), and the one that waited is refused in words.
 */
describe("cancelling a booking while its handover finishes", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: Client;
  let actor: ActingUser;
  let kit: ReturnType<typeof checklistKit>;
  const sentEmails: EmailMessage[] = [];

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    actor = await seedOperatorWithUser(admin, "Lock Order Rentals Pty Ltd");
    kit = checklistKit(web, createMemoryFileStorage(), sentEmails, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.end()]);
  });

  async function bookingWithChecklist() {
    const { rentalId } = await kit.readyRental();
    const inspectionId = await kit.filledHandover(rentalId);
    const shownFingerprint = await kit.shown(inspectionId);
    const accept = () =>
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
        { timeZone: TEST_TIME_ZONE, now: new Date() },
      );
    return { rentalId, inspectionId, accept };
  }

  const statusOf = async (table: "rentals" | "inspections", id: string) =>
    (await superuser.query<{ status: string }>(`select status from ${table} where id = $1`, [id]))
      .rows[0]?.status;

  it("finishes the handover that reached the rental first; the cancel is then refused", async () => {
    const booking = await bookingWithChecklist();
    // Holding the checklist: the handover takes the rental, then waits here.
    const holder = await openTransactionAs(actor.operatorId);
    await holder.client.query("select id from inspections where id = $1 for update", [
      booking.inspectionId,
    ]);
    const handedOver = booking.accept();
    await waitUntilBlockedBy(superuser, holder.pid);
    const cancelled = cancelRental(web.db, actor, booking.rentalId, CANCEL_REASON, new Date());
    // The cancel waits for the handover's lock on the rental, holding nothing the handover needs.
    await waitUntilBlockedBy(superuser, holder.pid, 2);
    await holder.client.query("commit");
    await holder.client.end();

    expect((await handedOver).status).toBe("completed");
    expect(await cancelled).toBe("not_allowed");
    expect(await statusOf("rentals", booking.rentalId)).toBe("active");
  });

  it("cancels the booking that reached the rental first; the handover is then refused as cancelled", async () => {
    const booking = await bookingWithChecklist();
    // Holding the rental: the cancel queues for it first, the handover after it.
    const holder = await openTransactionAs(actor.operatorId);
    await holder.client.query("select id from rentals where id = $1 for update", [
      booking.rentalId,
    ]);
    const cancelled = cancelRental(web.db, actor, booking.rentalId, CANCEL_REASON, new Date());
    await waitUntilBlockedBy(superuser, holder.pid);
    const handedOver = booking.accept();
    await waitUntilBlockedBy(superuser, holder.pid, 2);
    await holder.client.query("commit");
    await holder.client.end();

    expect(await cancelled).toBe("cancelled");
    expect(await handedOver).toEqual({ status: "cancelled" });
    expect(await statusOf("rentals", booking.rentalId)).toBe("cancelled");
    expect(await statusOf("inspections", booking.inspectionId)).toBe("cancelled");
  });
});
