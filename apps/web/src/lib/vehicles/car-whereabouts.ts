import { possessions, vehicles } from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { sql } from "drizzle-orm";

/** When the car last came back from a Renter, else when it was added. */
export const idleSince = sql<Date>`coalesce(
  (select max(${qualified(possessions.endedAt)}) from ${possessions}
    where ${qualified(possessions.vehicleId)} = ${qualified(vehicles.id)}),
  ${qualified(vehicles.createdAt)}
)`.mapWith(vehicles.createdAt);
