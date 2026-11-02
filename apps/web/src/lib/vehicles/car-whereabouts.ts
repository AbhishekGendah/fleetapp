import { possessions, renters, vehicles } from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { sql } from "drizzle-orm";

/** The car's possession still open: who has it now (rule 15). */
const openPossessionOfCar = sql`${qualified(possessions.vehicleId)} = ${qualified(vehicles.id)} and ${qualified(possessions.endedAt)} is null`;

/** The Renter who has the car now, or null when nobody does. */
export const renterWithCar = sql<string | null>`(
  select ${qualified(renters.fullName)} from ${possessions}
  join ${renters} on ${qualified(renters.id)} = ${qualified(possessions.renterId)}
  where ${openPossessionOfCar}
  limit 1
)`;

/** Since when they have had it: the handover acceptance. */
export const withRenterSince = sql<Date | null>`(
  select ${qualified(possessions.startedAt)} from ${possessions}
  where ${openPossessionOfCar}
  limit 1
)`.mapWith(possessions.startedAt);

/** When the car last came back from a Renter, else when it was added. */
export const idleSince = sql<Date>`coalesce(
  (select max(${qualified(possessions.endedAt)}) from ${possessions}
    where ${qualified(possessions.vehicleId)} = ${qualified(vehicles.id)}),
  ${qualified(vehicles.createdAt)}
)`.mapWith(vehicles.createdAt);
