import { renterDisplayName } from "@fleetapp/core";

import { appDb } from "../../../lib/app-db";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";
import { listBusinessCarRentals } from "../../../lib/renters/business-car-rentals";
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
  /** Each of its rentals' money, from its own ledger lines (rule 11): booked or out first, then newest. */
  moneyByCar: CarMoney[];
  /** Its oldest finished cars are left out of moneyByCar (still in the totals): the page says so. */
  isMoneyByCarCut: boolean;
  /** A driver's name by their id, for naming who drives each car. */
  driverNames: ReadonlyMap<string, string>;
}

export async function loadBusinessPageData(
  organisationId: string,
  user: SignedInUser,
  clock: RentalClock,
  page: RenterPageData,
): Promise<BusinessPageData> {
  const [{ drivers, carsOut }, carRentals] = await Promise.all([
    listBusinessDrivers(appDb, user.operatorId, organisationId),
    listBusinessCarRentals(appDb, user.operatorId, organisationId, clock),
  ]);
  const driverNames = new Map(
    drivers.map((driver) => [
      driver.driverId,
      renterDisplayName(driver.fullName, driver.preferredName),
    ]),
  );
  return {
    currentDrivers: drivers.filter((driver) => driver.removedAt === null),
    pastDrivers: drivers.filter((driver) => driver.removedAt !== null),
    carsOut,
    moneyByCar: moneyByCar(
      page.ledger.lines,
      carRentals.rentals.map((rental) => ({
        id: rental.id,
        rego: rental.rego,
        vehicleId: rental.vehicleId,
        status: rental.status,
        driverName: rental.driverId ? (driverNames.get(rental.driverId) ?? null) : null,
      })),
    ),
    isMoneyByCarCut: carRentals.isCut,
    driverNames,
  };
}
