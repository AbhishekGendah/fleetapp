import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { loadBondAccount } from "../src/lib/bonds/bond-account";
import { recordBondReceived, reverseBondMovement } from "../src/lib/bonds/bond-records";
import { stopBondPageAfterHandEntry } from "../src/lib/payments/renter-checkout";
import {
  createStandInPayments,
  type SignedEvent,
  type StandInPayments,
} from "../src/lib/payments/stand-in-provider";
import { seedOperatorWithUser } from "./car-fixtures";
import { oneAfterTheOther, outcomeOf } from "./lock-fixtures";
import { PAYMENTS_WEBHOOK_SECRET, paymentsTestKit } from "./payment-fixtures";

/** The test rental's bond: $500 (bookTestRental). */
const BOND_CENTS = 500_00;
const CASH_CENTS = 300_00;
const TODAY = "2026-11-09";

/**
 * Bond entered by hand while Stripe's news about the same bond is recorded
 * ("Lock order", lock modes): both lock the rental first, so one waits for
 * the other and then sees what it recorded. Before, Stripe's side took no
 * lock, so the bond could be recorded twice. Each test holds the rental from
 * a third connection, queues the two in a set order behind it, then lets go.
 */
describe("bond by hand and Stripe's news about the bond, at the same moment", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: Client;
  let stripe: StandInPayments;
  let actor: ActingUser;
  const kit = paymentsTestKit(() => ({ web, stripe }));

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    stripe = createStandInPayments(PAYMENTS_WEBHOOK_SECRET);
    actor = await seedOperatorWithUser(admin, "Bond Lock Order Rentals Pty Ltd");
    await kit.connectStripe(actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.end()]);
  });

  /** Runs the two in this order, each waiting for the rental another connection holds. */
  function inOrder<First, Second>(
    rentalId: string,
    first: () => Promise<First>,
    second: () => Promise<Second>,
  ): Promise<{ first: First; second: Second }> {
    const lockQuery = "select id from rentals where id = $1 for no key update";
    const held = { operatorId: actor.operatorId, lockQuery, id: rentalId };
    return oneAfterTheOther(superuser, held, first, second);
  }

  function cashBond(rentalId: string, amountCents: number) {
    return recordBondReceived(web.db, actor, rentalId, {
      amountCents,
      method: "cash",
      reference: null,
      occurredOn: TODAY,
    });
  }

  function correctEntry(rentalId: string, movementId: string) {
    return reverseBondMovement(
      web.db,
      actor,
      { rentalId, movementId },
      { note: "Entered by mistake." },
      TODAY,
    );
  }

  function delivered(event: SignedEvent): Promise<string> {
    return outcomeOf(kit.deliver(event).then((status) => ({ status })));
  }

  function heldOf(rentalId: string): Promise<number> {
    return loadBondAccount(web.db, actor.operatorId, { id: rentalId, bondCents: BOND_CENTS }).then(
      (account) => account.heldCents,
    );
  }

  /** A rental whose Renter has Stripe's bond page open, and the message once they pay it by card. */
  async function bondPagePaid() {
    const rental = await kit.bookedRental(actor);
    const visit = await kit.openedPaymentsLink(actor, rental.rentalId);
    const sessionId = await kit.visitStripe(visit, "bond");
    return { rental, sessionId, paid: stripe.finishCheckout(sessionId, "card") };
  }

  it("records Stripe's bond first, then refuses the cash as already held", async () => {
    const { rental, paid } = await bondPagePaid();

    const { first, second } = await inOrder(
      rental.rentalId,
      () => delivered(paid),
      () => cashBond(rental.rentalId, BOND_CENTS),
    );

    expect(first).toBe("handled");
    expect(second).toEqual({ status: "more_than_owing", owingCents: 0 });
    expect(await heldOf(rental.rentalId)).toBe(BOND_CENTS);
  });

  it("records the cash first, then Stripe's bond once, and says it is held twice", async () => {
    const { rental, sessionId, paid } = await bondPagePaid();

    const { first, second } = await inOrder(
      rental.rentalId,
      () => cashBond(rental.rentalId, BOND_CENTS),
      () => delivered(paid),
    );

    // The Renter really paid both: each is recorded once, and the Operator is told to refund one.
    expect(first).toMatchObject({ status: "saved", openBondPageId: sessionId });
    expect(second).toBe("handled");
    const openBondPageId = first.status === "saved" ? first.openBondPageId : null;
    expect(await stopBondPageAfterHandEntry(kit.deps(), actor.operatorId, openBondPageId)).toBe(
      "just_paid",
    );
    expect(await delivered(paid)).toBe("repeat");
    expect(await heldOf(rental.rentalId)).toBe(2 * BOND_CENTS);
  });

  /** $300 cash and the $200 rest paid by card on Stripe's page: the bond held in full. */
  async function cashAndCard() {
    const rental = await kit.bookedRental(actor);
    const cash = await cashBond(rental.rentalId, CASH_CENTS);
    if (cash.status !== "saved") {
      throw new Error(cash.status);
    }
    const visit = await kit.openedPaymentsLink(actor, rental.rentalId);
    const sessionId = await kit.visitStripe(visit, "bond");
    expect(await kit.deliver(stripe.finishCheckout(sessionId, "card"))).toBe("handled");
    expect(await heldOf(rental.rentalId)).toBe(BOND_CENTS);
    const cashEntry = cash.account.movements.find((movement) => movement.method === "cash")!;
    return { rental, sessionId, cashEntryId: cashEntry.id };
  }

  const STRIPE_CENTS = BOND_CENTS - CASH_CENTS;

  describe.each(["refund", "dispute"] as const)("the cash corrected while a %s", (kind) => {
    it(`comes in first: the correction sees the ${kind} taken off`, async () => {
      const { rental, sessionId, cashEntryId } = await cashAndCard();
      const { event } = stripe.takeBack(sessionId, { kind, amountCents: STRIPE_CENTS });

      const { first, second } = await inOrder(
        rental.rentalId,
        () => delivered(event),
        () => correctEntry(rental.rentalId, cashEntryId),
      );

      expect(first).toBe("handled");
      expect(second).toMatchObject({ status: "saved", account: { heldCents: 0 } });
      expect(await delivered(event)).toBe("repeat");
      expect(await heldOf(rental.rentalId)).toBe(0);
    });

    it(`comes in second: the ${kind} is taken off after the correction`, async () => {
      const { rental, sessionId, cashEntryId } = await cashAndCard();
      const { event } = stripe.takeBack(sessionId, { kind, amountCents: STRIPE_CENTS });

      const { first, second } = await inOrder(
        rental.rentalId,
        () => correctEntry(rental.rentalId, cashEntryId),
        () => delivered(event),
      );

      expect(first).toMatchObject({ status: "saved", account: { heldCents: STRIPE_CENTS } });
      expect(second).toBe("handled");
      expect(await delivered(event)).toBe("repeat");
      expect(await heldOf(rental.rentalId)).toBe(0);
    });
  });
});
