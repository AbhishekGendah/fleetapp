import { todayInTimeZone } from "@fleetapp/core";

import { listChargeTypes } from "../ledger/charge-types";
import { loadRentalLedger } from "../ledger/ledger-queries";
import { addCharge, recordPayment } from "../ledger/ledger-records";
import { expectSaved, type DemoContext } from "./demo-context";
import { DEMO_ACTIVE_RENTAL_CODES } from "./demo-plan";
import { findRental } from "./demo-rentals";

/** Overdue and not paying: their rent stays owing. */
const OWING_RENTALS: ReadonlySet<string> = new Set(["R13", "R14"]);
/** Paying it off: half the balance paid. */
const HALF_PAID_RENTALS: ReadonlySet<string> = new Set(["R05"]);
/** A cleaning charge added before the payment. */
const CLEANED_RENTAL = "R02";
const CLEANING_CENTS = 60_00;
const HALF = 2;

/**
 * Money for the demo (rent is already on each ledger from its handover):
 * a cleaning charge on one rental, then most Renters paid up by bank
 * transfer, one half paid and the two overdue ones owing. A rental that
 * already has a payment is left alone.
 */
export async function addDemoMoney(context: DemoContext): Promise<number> {
  const { database } = context.deps;
  const operatorId = context.actor.operatorId;
  const today = todayInTimeZone(new Date(), context.timeZone);
  const cleaning = (await listChargeTypes(database, operatorId)).find(
    (type) => type.builtIn === "cleaning",
  );
  let added = 0;
  for (const code of DEMO_ACTIVE_RENTAL_CODES) {
    const rental = await findRental(context, code);
    if (!rental || OWING_RENTALS.has(code)) {
      continue;
    }
    const before = await loadRentalLedger(database, operatorId, rental.id);
    if (before.lines.some((line) => line.kind === "payment")) {
      continue;
    }
    if (code === CLEANED_RENTAL && cleaning) {
      const charged = await addCharge(database, context.actor, rental.id, {
        chargeTypeId: cleaning.id,
        amountCents: CLEANING_CENTS,
        description: "Demo data: interior cleaning",
        effectiveOn: today,
      });
      expectSaved(charged.status, ["saved"], `cleaning charge on ${code}`);
    }
    const owing = (await loadRentalLedger(database, operatorId, rental.id)).balanceCents;
    const paying = HALF_PAID_RENTALS.has(code) ? Math.floor(owing / HALF) : owing;
    if (paying <= 0) {
      continue;
    }
    const paid = await recordPayment(database, context.actor, rental.id, {
      amountCents: paying,
      method: "bank_transfer",
      reference: `DEMO-${code}`,
      occurredOn: today,
    });
    expectSaved(paid.status, ["saved"], `payment on ${code}`);
    added += 1;
  }
  return added;
}
