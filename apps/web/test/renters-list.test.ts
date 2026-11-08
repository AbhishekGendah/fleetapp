import { parseListQuery } from "@fleetapp/core";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { RENTER_LIST } from "../src/app/renters/renter-list";
import type { ActingUser } from "../src/lib/acting-user";
import { listChargeTypes } from "../src/lib/ledger/charge-types";
import { addCharge, recordPayment } from "../src/lib/ledger/ledger-records";
import { loadRenterMoney } from "../src/lib/renters/renter-money";
import { countRentersByFilter, listRenterPage } from "../src/lib/renters/renter-queries";
import { loadRenterRentalsUnderWay } from "../src/lib/renters/renter-rentals-now";
import { archiveRenter, changeRenterStatus } from "../src/lib/renters/renter-records";
import { seedOperatorWithUser } from "./car-fixtures";
import {
  addTestRenter,
  bookTestRental,
  recordTestHandover,
  TEST_TIME_ZONE,
} from "./rental-fixtures";

const CLOCK = { timeZone: TEST_TIME_ZONE, now: new Date("2026-11-06T02:00:00Z") };
/** Long past the grace days on CLOCK's day. */
const LONG_AGO = "2026-10-20";
const OVERDUE_RULE = { today: "2026-11-06", graceDays: 2 };

/**
 * The Renters list (7 Nov 2026 look): its filters in plain words with their
 * counts, what each Renter owes across their rentals (from the ledger) and
 * whether any of it is overdue, and none of it ever crossing to another
 * business.
 */
describe("the Renters list", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: TestConnection;
  let actor: ActingUser;
  let otherActor: ActingUser;
  let rentingId: string;
  let bookedId: string;
  let refusedId: string;
  let othersId: string;

  async function chargeTypeId(owner: ActingUser): Promise<string> {
    const types = await listChargeTypes(web.db, owner.operatorId);
    return types.find((type) => type.label === "Cleaning")!.id;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    actor = await seedOperatorWithUser(admin, "Listed Renters Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Listed Renters Pty Ltd");

    rentingId = await addTestRenter(web, actor, "Rita Renting");
    const out = await bookTestRental(web, actor, rentingId);
    await recordTestHandover(superuser, out.rentalId, new Date("2026-10-02T01:00:00Z"));
    // Owes on one rental, long past the grace days; in credit on another.
    await addCharge(web.db, actor, out.rentalId, {
      chargeTypeId: await chargeTypeId(actor),
      amountCents: 80_00,
      description: "Seats cleaned",
      effectiveOn: LONG_AGO,
    });
    bookedId = await addTestRenter(web, actor, "Bob Booked");
    await bookTestRental(web, actor, bookedId);
    const second = await bookTestRental(web, actor, rentingId);
    await recordPayment(web.db, actor, second.rentalId, {
      amountCents: 30_00,
      method: "cash",
      reference: null,
      occurredOn: LONG_AGO,
    });

    refusedId = await addTestRenter(web, actor, "Dee Declined");
    await changeRenterStatus(web.db, actor, refusedId, {
      status: "do_not_rent",
      doNotRentReason: "Unpaid fines",
    });
    await archiveRenter(web.db, actor, await addTestRenter(web, actor, "Archie Archived"));

    othersId = await addTestRenter(web, otherActor, "Otto Other");
    const others = await bookTestRental(web, otherActor, othersId);
    await addCharge(web.db, otherActor, others.rentalId, {
      chargeTypeId: await chargeTypeId(otherActor),
      amountCents: 999_00,
      description: "Not the first business's",
      effectiveOn: LONG_AGO,
    });
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.close()]);
  });

  it("counts each filter: Renting now, Booked, To review, Do not rent and Archived", async () => {
    expect(await countRentersByFilter(web.db, actor.operatorId)).toEqual({
      all: 3,
      renting: 1,
      booked: 1,
      "to-review": 0,
      businesses: 0,
      drivers: 0,
      "do-not-rent": 1,
      archived: 1,
    });
  });

  it("filters by the plain words; a Renter with a car out is Renting, not Booked", async () => {
    const idsFor = async (status: string) =>
      (
        await listRenterPage(web.db, actor.operatorId, parseListQuery(RENTER_LIST, { status }))
      ).rows.map((renter) => renter.id);
    expect(await idsFor("renting")).toEqual([rentingId]);
    expect(await idsFor("booked")).toEqual([bookedId]);
    expect(await idsFor("do-not-rent")).toEqual([refusedId]);
    expect(await idsFor("archived")).toHaveLength(1);
  });

  it("adds up what each Renter owes across their rentals, and finds it overdue", async () => {
    const money = await loadRenterMoney(
      web.db,
      actor.operatorId,
      [rentingId, bookedId],
      OVERDUE_RULE,
    );
    expect(money.get(rentingId)?.balanceCents).toBe(80_00 - 30_00);
    // The credit on the second rental does not hide the first's arrears.
    expect(money.get(rentingId)?.overdue).toMatchObject({ oldestDueOn: LONG_AGO });
    expect(money.has(bookedId)).toBe(false);
  });

  it("names each Renter's rentals out or booked, the car out first", async () => {
    const byRenter = await loadRenterRentalsUnderWay(
      web.db,
      actor.operatorId,
      [rentingId, bookedId],
      CLOCK,
    );
    expect(
      byRenter
        .get(rentingId)
        ?.map((rental) => rental.status)
        .sort(),
    ).toEqual(["active", "booked"]);
    expect(byRenter.get(bookedId)).toHaveLength(1);
  });

  it("never shows one business another's Renters, rentals or what they owe", async () => {
    const asA = await loadRenterMoney(web.db, actor.operatorId, [othersId], OVERDUE_RULE);
    expect(asA.size).toBe(0);
    const asB = await loadRenterMoney(web.db, otherActor.operatorId, [othersId], OVERDUE_RULE);
    expect(asB.get(othersId)?.balanceCents).toBe(999_00);
    expect(
      (await loadRenterRentalsUnderWay(web.db, actor.operatorId, [othersId], CLOCK)).size,
    ).toBe(0);
    expect((await countRentersByFilter(web.db, otherActor.operatorId)).all).toBe(1);
    const page = await listRenterPage(web.db, actor.operatorId, parseListQuery(RENTER_LIST, {}));
    expect(page.rows.map((renter) => renter.id)).not.toContain(othersId);
  });
});
