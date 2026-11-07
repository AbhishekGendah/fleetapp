import { appDb } from "../../../lib/app-db";
import { listCarDamage, type DamageSummary } from "../../../lib/damage/damage-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";
import { carNowInputOf, carNowOf, type CarNow } from "../../../lib/vehicles/car-now";
import { loadCarRentalsNow, type CarRentalsNow } from "../../../lib/vehicles/car-rentals-now";
import {
  withExpiryStatuses,
  type ExpiryContext,
  type WithExpiryStatuses,
} from "../../../lib/vehicles/expiry-columns";
import { loadExpiryContext } from "../../../lib/vehicles/expiry-context";
import { loadVehiclePaperwork, type Policy } from "../../../lib/vehicles/paperwork-queries";
import {
  loadVehicleSummary,
  type VehicleDetail,
  type VehicleSummary,
} from "../../../lib/vehicles/vehicle-queries";

/** What the strip and the Overview show beyond the car itself, loaded once for the page. */
export interface CarPageData {
  /** Its rego and insurance dates and how they stand, as the Cars list has them. */
  summary: WithExpiryStatuses<VehicleSummary>;
  rentals: CarRentalsNow;
  now: CarNow | null;
  /** The policy that runs latest, whose end the strip shows. */
  latestPolicy: Policy | null;
  expiry: ExpiryContext;
  damage: DamageSummary[];
}

export async function loadCarPageData(
  vehicle: VehicleDetail,
  user: SignedInUser,
  clock: RentalClock,
): Promise<CarPageData> {
  const [summary, rentalsByCar, paperwork, expiry, damage] = await Promise.all([
    loadVehicleSummary(appDb, user.operatorId, vehicle.id),
    loadCarRentalsNow(appDb, user.operatorId, [vehicle.id], clock),
    loadVehiclePaperwork(appDb, user.operatorId, vehicle.id),
    loadExpiryContext(user),
    listCarDamage(appDb, user.operatorId, vehicle.id),
  ]);
  if (!summary) {
    throw new Error("The car went missing while its page loaded.");
  }
  const rentals = rentalsByCar.get(vehicle.id) ?? { withRenter: null, nextBooking: null };
  const [withStatuses] = withExpiryStatuses([summary], expiry);
  return {
    summary: withStatuses!,
    rentals,
    now: carNowOf(carNowInputOf(summary, rentals), clock),
    latestPolicy: paperwork.policies[0] ?? null,
    expiry,
    damage,
  };
}
