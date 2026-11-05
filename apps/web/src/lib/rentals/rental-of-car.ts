import { possessions, rentals } from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { eq, or, sql, type SQL } from "drizzle-orm";

/**
 * The rental is this car's: on it now, or the Renter had it at some point
 * (a swap moves the rental to the new car, but the old car's damage and its
 * Rentals tab still belong with it: review A6-7).
 */
export function isRentalOfCar(vehicleId: string): SQL {
  return or(
    eq(rentals.vehicleId, vehicleId),
    sql`exists (
      select 1 from ${possessions}
      where ${qualified(possessions.rentalId)} = ${qualified(rentals.id)}
        and ${qualified(possessions.operatorId)} = ${qualified(rentals.operatorId)}
        and ${qualified(possessions.vehicleId)} = ${vehicleId}
    )`,
  )!;
}
