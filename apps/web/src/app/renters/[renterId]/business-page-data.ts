import { renterDisplayName } from "@fleetapp/core";
import { rentals } from "@fleetapp/db/schema";
import { eq } from "drizzle-orm";

import { appDb } from "../../../lib/app-db";
import { MOST_OF_A_KIND } from "../../../lib/dashboard/fleet-overview";
import { listRentalSummaries, type RentalSummary } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";
import { moneyByCar, type CarMoney } from "../../../lib/renters/business-money";
import {
  listBusinessDrivers,
  type BusinessDriver,
  type DriverCarOut,
} from "../../../lib/renters/organisation-driver-queries";
import type { RenterPageData } from "./renter-page-data";

/** What a business Renter's page shows beyond a person's: its drivers, its cars and their money. */
export interface BusinessPageData {
  currentDrivers: BusinessDriver[];
  pastDrivers: BusinessDriver[];
  /** The business's cars out now, with who has each. */
  carsOut: DriverCarOut[];
  /** Every rental of the business, soonest start first. */
  rentals: RentalSummary[];
  /** Each of its rentals' money, from its own ledger lines (rule 11). */
  moneyByCar: CarMoney[];
  /** A driver's name by their id, for naming who drives each car. */
  driverNames: ReadonlyMap<string, string>;
}

export async function loadBusinessPageData(
  organisationId: string,
  user: SignedInUser,
  clock: RentalClock,
  page: RenterPageData,
): Promise<BusinessPageData> {
  const [{ drivers, carsOut }, businessRentals] = await Promise.all([
    listBusinessDrivers(appDb, user.operatorId, organisationId),
    listRentalSummaries(appDb, user.operatorId, {
      where: eq(rentals.renterId, organisationId),
      clock,
      limit: MOST_OF_A_KIND,
    }),
  ]);
  const driverNames = new Map(
    drivers.map((driver) => [
      driver.driverId,
      renterDisplayName(driver.fullName, driver.preferredName),
    ]),
  );
  // Latest first, as the Rentals tab lists them.
  const latestFirst = [...businessRentals].reverse();
  return {
    currentDrivers: drivers.filter((driver) => driver.removedAt === null),
    pastDrivers: drivers.filter((driver) => driver.removedAt !== null),
    carsOut,
    rentals: latestFirst,
    moneyByCar: moneyByCar(
      page.ledger.lines,
      latestFirst.map((rental) => ({
        id: rental.id,
        rego: rental.rego,
        vehicleId: rental.vehicleId,
        status: rental.status,
        driverName: rental.driverId ? (driverNames.get(rental.driverId) ?? null) : null,
      })),
    ),
    driverNames,
  };
}
