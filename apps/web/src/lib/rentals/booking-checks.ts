import {
  bookingProblems,
  todayInTimeZone,
  type BookingProblem,
  type OperatorSettings,
  type VehicleStatus,
} from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { files, renters, vehicles } from "@fleetapp/db/schema";
import { and, countDistinct, eq, isNull } from "drizzle-orm";

import { licenceScanInUse } from "../files/stored-files";

/** Both sides of a licence: front and back. */
const LICENCE_SIDE_COUNT = 2;

export interface BookingParties {
  renter: typeof renters.$inferSelect;
  carStatus: VehicleStatus;
}

/**
 * The Operator's current Renter and car, both locked for this transaction:
 * the car so two bookings of it are made one after the other, the Renter so
 * their details cannot change under the checks. Otherwise, which one is missing.
 */
export async function lockBookingParties(
  tx: AnyTransaction,
  operatorId: string,
  ids: { renterId: string; vehicleId: string },
): Promise<BookingParties | "renter_not_found" | "car_not_found"> {
  const [car] = await tx
    .select({ status: vehicles.status })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.id, ids.vehicleId),
        eq(vehicles.operatorId, operatorId),
        isNull(vehicles.archivedAt),
      ),
    )
    .for("update");
  if (!car) {
    return "car_not_found";
  }
  const [renter] = await tx
    .select()
    .from(renters)
    .where(
      and(
        eq(renters.id, ids.renterId),
        eq(renters.operatorId, operatorId),
        isNull(renters.archivedAt),
      ),
    )
    .for("update");
  return renter ? { renter, carStatus: car.status } : "renter_not_found";
}

async function hasBothLicenceScans(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ sides: countDistinct(files.licenceSide) })
    .from(files)
    .where(and(licenceScanInUse(operatorId), eq(files.renterId, renterId)));
  return (row?.sides ?? 0) >= LICENCE_SIDE_COUNT;
}

/** What stands between this Renter and this car for these dates, on the Operator's clock. */
export async function findBookingProblems(
  tx: AnyTransaction,
  parties: BookingParties,
  period: { start: Date; end: Date | null; timeZone: string; now: Date },
  settings: Pick<OperatorSettings, "minimumRenterAgeYears" | "isProvisionalLicenceAllowed">,
): Promise<BookingProblem[]> {
  const { renter } = parties;
  const dateOf = (moment: Date): string => todayInTimeZone(moment, period.timeZone);
  return bookingProblems({
    renter: {
      status: renter.status,
      dateOfBirth: renter.dateOfBirth,
      residentialAddress: renter.residentialAddress,
      licenceType: renter.licenceType,
      licenceExpiresOn: renter.licenceExpiresOn,
      hasBothLicenceScans: await hasBothLicenceScans(tx, renter.operatorId, renter.id),
    },
    carStatus: parties.carStatus,
    startDate: dateOf(period.start),
    endDate: period.end === null ? null : dateOf(period.end),
    today: dateOf(period.now),
    rules: settings,
  });
}
