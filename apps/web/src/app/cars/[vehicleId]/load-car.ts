import { isRecordId } from "@fleetapp/core";
import { notFound } from "next/navigation";

import { appDb } from "../../../lib/app-db";
import type { SignedInUser } from "../../../lib/require-user";
import { loadVehicle, type VehicleDetail } from "../../../lib/vehicles/vehicle-queries";

/** The signed-in User's car from the page address, or the not-found page. */
export async function loadCarOrNotFound(
  user: SignedInUser,
  vehicleId: string,
): Promise<VehicleDetail> {
  const vehicle = isRecordId(vehicleId)
    ? await loadVehicle(appDb, user.operatorId, vehicleId)
    : null;
  if (!vehicle) {
    notFound();
  }
  return vehicle;
}
