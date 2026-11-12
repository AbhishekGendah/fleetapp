import { randomUUID } from "node:crypto";

import { paymentMandates, renterStripeCustomers } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { TestConnection } from "@fleetapp/db/testing";

import type { ActingUser } from "../src/lib/acting-user";
import { chargeRentFor } from "../src/lib/ledger/rent-job";
import { addCurrentPaperwork, addTestCar } from "./car-fixtures";
import {
  addTestRenter,
  bookTestRentalOn,
  recordTestHandover,
  TEST_RENTAL_PERIOD,
} from "./rental-fixtures";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** A rental out for eight and a half days: its second rent week began a day and a half ago. */
export const OUT_FOR_MS = 8 * DAY_MS + 12 * HOUR_MS;

/** A made-up Stripe ID in Stripe's shape. */
function stripeId(prefix: string): string {
  return `${prefix}_standin${randomUUID().replaceAll("-", "")}`;
}

/** Debit tests' rentals: Renters paying by direct debit, with a long-term car out. */
export function debitTestKit(current: () => { web: TestConnection; superuser: TestConnection }) {
  /** The Renter's direct debit as Stripe's page leaves it: a customer and an active mandate. */
  async function addDirectDebit(owner: ActingUser, renterId: string): Promise<void> {
    await withTenant(current().web.db, owner.operatorId, async (tx) => {
      await tx.insert(renterStripeCustomers).values({
        operatorId: owner.operatorId,
        renterId,
        stripeCustomerId: stripeId("cus"),
      });
      await tx.insert(paymentMandates).values({
        operatorId: owner.operatorId,
        renterId,
        method: "becs_debit",
        status: "active",
        stripeSetupIntentId: stripeId("seti"),
        stripePaymentMethodId: stripeId("pm"),
        stripeMandateId: stripeId("mandate"),
        setUpAt: new Date(),
        activatedAt: new Date(),
      });
    });
  }

  /** An ongoing rental out since `handedOverAt` with its rent charged to now, for a Renter paying by direct debit. */
  async function rentalOut(
    owner: ActingUser,
    options: { renterId?: string; handedOverAt?: Date } = {},
  ) {
    const { web, superuser } = current();
    const renterId = options.renterId ?? (await addTestRenter(web, owner));
    if (!options.renterId) {
      await addDirectDebit(owner, renterId);
    }
    const vehicleId = await addTestCar(web, owner);
    await addCurrentPaperwork(web, owner, vehicleId);
    const { rentalId } = await bookTestRentalOn(web, owner, {
      renterId,
      vehicleId,
      period: { plannedStart: TEST_RENTAL_PERIOD.plannedStart, plannedEnd: null },
    });
    const handedOverAt = options.handedOverAt ?? new Date(Date.now() - OUT_FOR_MS);
    await recordTestHandover(superuser, rentalId, handedOverAt);
    await chargeRentFor(web.db, owner.operatorId, new Date(), [rentalId]);
    return { rentalId, renterId, vehicleId, handedOverAt };
  }

  return { addDirectDebit, rentalOut };
}
