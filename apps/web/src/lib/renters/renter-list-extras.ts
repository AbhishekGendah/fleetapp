import { todayInTimeZone } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";

import { loadBondsToRefund } from "../dashboard/bonds-to-refund";
import { MOST_OF_A_KIND } from "../dashboard/fleet-overview";
import type { RentalClock } from "../rentals/rental-records";
import { loadOperatorSettings } from "../settings/operator-settings";
import type { RenterListExtras } from "./renter-list-rows";
import { loadRenterMoney } from "./renter-money";
import { loadCurrentBusinessesOf } from "./organisation-driver-queries";
import { loadRenterRentalsUnderWay } from "./renter-rentals-now";

/**
 * What the Renters list shows beside the Renters themselves, for one page of
 * them: their rentals out or booked, what they owe and whether it is overdue
 * (from the ledger, with today's grace days as Needs attention reads them),
 * whose bond is to refund, and the businesses each driver drives for. Only the Operator's own (rules 1 and 2).
 */
export async function loadRenterListExtras(
  database: AnyDatabase,
  operatorId: string,
  renterIds: readonly string[],
  clock: RentalClock,
): Promise<RenterListExtras> {
  const settings = await loadOperatorSettings(database, operatorId);
  const overdueRule = {
    today: todayInTimeZone(clock.now, clock.timeZone),
    graceDays: settings.paymentGraceDays,
  };
  const [rentalsUnderWay, money, bonds, businessesOf] = await Promise.all([
    loadRenterRentalsUnderWay(database, operatorId, renterIds, clock),
    loadRenterMoney(database, operatorId, renterIds, overdueRule),
    loadBondsToRefund(database, operatorId, MOST_OF_A_KIND),
    loadCurrentBusinessesOf(database, operatorId, renterIds),
  ]);
  return {
    rentalsUnderWay,
    money,
    bondToRefundRenterIds: new Set(bonds.items.map((bond) => bond.renterId)),
    businessesOf,
  };
}
