import type { ListQuery } from "@fleetapp/core";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { listChargeTypes } from "../src/lib/ledger/charge-types";
import { addCharge, recordPayment } from "../src/lib/ledger/ledger-records";
import { loadRentalBalances } from "../src/lib/ledger/rental-balances";
import {
  countRentalsByStatus,
  listRentalPage,
  RELEVANCE_ORDER,
} from "../src/lib/rentals/rental-queries";
import { cancelRental } from "../src/lib/rentals/rental-records";
import { seedOperatorWithUser } from "./car-fixtures";
import { addTestRenter, bookTestRental, TEST_TIME_ZONE } from "./rental-fixtures";

const CLOCK = { timeZone: TEST_TIME_ZONE, now: new Date("2026-11-06T02:00:00Z") };
const CHARGE_DAY = "2027-06-02";

function listQuery(filters: Record<string, string> = {}): ListQuery {
  return { search: "", sort: { column: RELEVANCE_ORDER, direction: "asc" }, filters, page: 1 };
}

/**
 * The Rentals list: what each rental's Renter owes, added up from the ledger
 * in one go for the page; the status filters in plain words; and none of it
 * ever crossing to another business.
 */
describe("the Rentals list", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherActor: ActingUser;
  let owingId: string;
  let untouchedId: string;
  let cancelledId: string;
  let othersId: string;

  async function chargeTypeId(owner: ActingUser): Promise<string> {
    const types = await listChargeTypes(web.db, owner.operatorId);
    return types.find((type) => type.label === "Cleaning")!.id;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Listed Rentals Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Listed Rentals Pty Ltd");
    const renterId = await addTestRenter(web, actor, "Olive Owing");
    const otherRenterId = await addTestRenter(web, otherActor, "Otto Other");

    ({ rentalId: owingId } = await bookTestRental(web, actor, renterId));
    ({ rentalId: untouchedId } = await bookTestRental(web, actor, renterId));
    ({ rentalId: cancelledId } = await bookTestRental(web, actor, renterId));
    ({ rentalId: othersId } = await bookTestRental(web, otherActor, otherRenterId));

    await addCharge(web.db, actor, owingId, {
      chargeTypeId: await chargeTypeId(actor),
      amountCents: 80_00,
      description: "Seats cleaned",
      effectiveOn: CHARGE_DAY,
    });
    await recordPayment(web.db, actor, owingId, {
      amountCents: 30_00,
      method: "cash",
      reference: null,
      occurredOn: CHARGE_DAY,
    });
    await addCharge(web.db, otherActor, othersId, {
      chargeTypeId: await chargeTypeId(otherActor),
      amountCents: 999_00,
      description: "Not the first business's",
      effectiveOn: CHARGE_DAY,
    });
    await cancelRental(web.db, actor, cancelledId, { reason: "Plans changed" }, CLOCK.now);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("adds up what is owed on each rental from its ledger, leaving out those with no lines", async () => {
    const balances = await loadRentalBalances(web.db, actor.operatorId, [owingId, untouchedId]);
    expect(balances.get(owingId)).toBe(80_00 - 30_00);
    expect(balances.has(untouchedId)).toBe(false);
    expect(await loadRentalBalances(web.db, actor.operatorId, [])).toEqual(new Map());
  });

  it("never gives one business another's balances, even when asked for its rental", async () => {
    const asA = await loadRentalBalances(web.db, actor.operatorId, [owingId, othersId]);
    expect([...asA.keys()]).toEqual([owingId]);
    const asB = await loadRentalBalances(web.db, otherActor.operatorId, [owingId, othersId]);
    expect([...asB.entries()]).toEqual([[othersId, 999_00]]);

    const pageOfA = await listRentalPage(web.db, actor.operatorId, listQuery(), { clock: CLOCK });
    expect(pageOfA.rows.map((rental) => rental.id)).not.toContain(othersId);
  });

  it("filters by the plain-words groups, and still takes the old status names", async () => {
    const idsFor = async (status: string) =>
      (
        await listRentalPage(web.db, actor.operatorId, listQuery({ status }), { clock: CLOCK })
      ).rows.map((rental) => rental.id);
    expect(await idsFor("finished")).toEqual([cancelledId]);
    expect(await idsFor("cancelled")).toEqual([cancelledId]);
    expect(await idsFor("booked")).not.toContain(cancelledId);
    expect(await idsFor("out")).toEqual([]);
  });

  it("puts bookings before finished rentals, and counts each status", async () => {
    const page = await listRentalPage(web.db, actor.operatorId, listQuery(), { clock: CLOCK });
    expect(page.rows.map((rental) => rental.id).at(-1)).toBe(cancelledId);
    expect(await countRentalsByStatus(web.db, actor.operatorId)).toEqual({
      booked: 2,
      cancelled: 1,
    });
  });
});
