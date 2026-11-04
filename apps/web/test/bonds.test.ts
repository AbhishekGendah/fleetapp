import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { loadBondAccount } from "../src/lib/bonds/bond-account";
import { bondReceivedInputSchema, type BondReceivedInput } from "../src/lib/bonds/bond-input";
import { recordBondReceived, reverseBondMovement } from "../src/lib/bonds/bond-records";
import { loadRentalProblems } from "../src/lib/rentals/booking-checks";
import { loadRental } from "../src/lib/rentals/rental-queries";
import { cancelRental } from "../src/lib/rentals/rental-records";
import { seedOperatorWithUser } from "./car-fixtures";
import { addTestRenter, bookTestRental, TEST_TIME_ZONE } from "./rental-fixtures";

const TODAY = "2027-05-20";
/** The test rental's bond: $500. */
const BOND_CENTS = 500_00;

function received(amount: string, reference = "bnk 123"): BondReceivedInput {
  return bondReceivedInputSchema(TODAY).parse({
    amountCents: amount,
    method: "bank_transfer",
    reference,
    occurredOn: TODAY,
  });
}

describe("bonds", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherOperator: ActingUser;

  const clock = () => ({ timeZone: TEST_TIME_ZONE, now: new Date() });

  async function bookedRental(): Promise<string> {
    const renterId = await addTestRenter(web, actor);
    return (await bookTestRental(web, actor, renterId)).rentalId;
  }

  async function bondProblem(rentalId: string) {
    const rental = await loadRental(web.db, actor.operatorId, rentalId, clock());
    const problems = await loadRentalProblems(web.db, actor.operatorId, rental!, clock());
    return Array.isArray(problems)
      ? problems.find((problem) => problem.code === "bond_short")
      : null;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Bond Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Bond Rentals Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("checks what is typed: more than $0, not a day still to come, reference in capitals", () => {
    const schema = bondReceivedInputSchema(TODAY);
    const start = { amountCents: "100", method: "cash", reference: "", occurredOn: TODAY };

    expect(schema.safeParse({ ...start, amountCents: "0" }).success).toBe(false);
    expect(schema.safeParse({ ...start, occurredOn: "2027-05-21" }).success).toBe(false);
    expect(schema.safeParse({ ...start, method: "card" }).success).toBe(false);
    expect(received("100").reference).toBe("BNK 123");
  });

  it("works out what is held and owing from the entries, and lists a short bond before handover", async () => {
    const rentalId = await bookedRental();
    const before = await bondProblem(rentalId);

    const first = await recordBondReceived(web.db, actor, rentalId, received("200"));
    const account = await loadBondAccount(web.db, actor.operatorId, {
      id: rentalId,
      bondCents: BOND_CENTS,
    });

    expect(before).toEqual({
      code: "bond_short",
      level: "handover",
      owingCents: BOND_CENTS,
      onItsWayCents: 0,
    });
    expect(first.status).toBe("saved");
    expect([account.heldCents, account.owingCents]).toEqual([200_00, 300_00]);
    expect(await bondProblem(rentalId)).toMatchObject({ owingCents: 300_00 });
  });

  it("refuses more than is still to receive, and clears the handover check once held in full", async () => {
    const rentalId = await bookedRental();
    await recordBondReceived(web.db, actor, rentalId, received("300"));

    const tooMuch = await recordBondReceived(web.db, actor, rentalId, received("200.01"));
    const rest = await recordBondReceived(web.db, actor, rentalId, received("200"));

    expect(tooMuch).toEqual({ status: "more_than_owing", owingCents: 200_00 });
    expect(rest.status).toBe("saved");
    expect(await bondProblem(rentalId)).toBeUndefined();
  });

  it("corrects an entry once by cancelling it exactly, keeping both in the list", async () => {
    const rentalId = await bookedRental();
    const saved = await recordBondReceived(web.db, actor, rentalId, received("150"));
    const entryId = saved.status === "saved" ? saved.account.movements[0]!.id : "";
    const target = { rentalId, movementId: entryId };

    const corrected = await reverseBondMovement(
      web.db,
      actor,
      target,
      { note: "Typed twice" },
      TODAY,
    );
    const again = await reverseBondMovement(web.db, actor, target, { note: "Again" }, TODAY);

    expect(corrected.status === "saved" && corrected.account).toMatchObject({
      heldCents: 0,
      owingCents: BOND_CENTS,
    });
    expect(corrected.status === "saved" && corrected.account.movements).toHaveLength(2);
    expect(again).toEqual({ status: "not_reversible" });
  });

  it("takes no bond on a cancelled rental, and none on another Operator's rental", async () => {
    const rentalId = await bookedRental();
    const otherRentalId = await bookedRental();
    await cancelRental(web.db, actor, rentalId, { reason: "Changed plans" }, new Date());

    expect(await recordBondReceived(web.db, actor, rentalId, received("100"))).toEqual({
      status: "not_open",
    });
    expect(await recordBondReceived(web.db, otherOperator, otherRentalId, received("100"))).toEqual(
      { status: "not_found" },
    );
  });
});
