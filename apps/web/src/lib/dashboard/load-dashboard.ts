import { dashboardWindow, type DashboardWindow, type VehicleStatus } from "@fleetapp/core";

import { appDb } from "../app-db";
import { canHearRenterPayments } from "../payments/app-payments";
import { loadDamageAttention, type DamageAttention } from "../damage/damage-queries";
import { loadBondsToRefund, type BondToRefund } from "./bonds-to-refund";
import type { SignedInUser } from "../require-user";
import { loadOperatorSettings } from "../settings/operator-settings";
import {
  loadFleetCounts,
  loadIdleCars,
  loadLicencesDue,
  loadPaperworkDue,
  loadReviewsWaiting,
  loadWorkshopLate,
  type CarInWorkshop,
  type CarPaperworkDue,
  type FewOfMany,
  type IdleCar,
  type RenterLicenceDue,
  type RenterOnList,
} from "./fleet-overview";
import {
  loadBookingReadiness,
  loadRentalsThisWeek,
  type BookingReadiness,
  type RentalThisWeek,
} from "./rentals-this-week";

export interface DashboardData {
  window: DashboardWindow;
  rentals: RentalThisWeek[];
  notReady: BookingReadiness[];
  fleetCounts: Partial<Record<VehicleStatus, number>>;
  idleCars: FewOfMany<IdleCar>;
  paperworkDue: FewOfMany<CarPaperworkDue>;
  workshopLate: FewOfMany<CarInWorkshop>;
  licencesDue: FewOfMany<RenterLicenceDue>;
  reviewsWaiting: FewOfMany<RenterOnList>;
  damage: DamageAttention;
  bondsToRefund: FewOfMany<BondToRefund>;
  vehicleWarningDays: number;
}

/** Everything the dashboard shows for the signed-in User's Operator, loaded together. */
export async function loadDashboard(user: SignedInUser): Promise<DashboardData> {
  const now = new Date();
  const window = dashboardWindow(now, user.operatorTimezone);
  const clock = { timeZone: user.operatorTimezone, now };
  const operatorId = user.operatorId;
  const settings = await loadOperatorSettings(appDb, operatorId);
  const [rentals, fleetCounts, idleCars, paperworkDue, workshopLate, licencesDue, reviewsWaiting] =
    await Promise.all([
      loadRentalsThisWeek(appDb, operatorId, window, clock),
      loadFleetCounts(appDb, operatorId),
      loadIdleCars(appDb, operatorId, now),
      loadPaperworkDue(appDb, operatorId, {
        today: window.today,
        warningDays: settings.vehicleExpiryWarningDays,
      }),
      loadWorkshopLate(appDb, operatorId, window.today),
      loadLicencesDue(appDb, operatorId, {
        today: window.today,
        warningDays: settings.licenceExpiryWarningDays,
      }),
      loadReviewsWaiting(appDb, operatorId),
    ]);
  const [notReady, damage, bondsToRefund] = await Promise.all([
    loadBookingReadiness(appDb, operatorId, rentals, clock, { canHearRenterPayments }),
    loadDamageAttention(appDb, operatorId),
    loadBondsToRefund(appDb, operatorId),
  ]);
  return {
    window,
    rentals,
    notReady,
    fleetCounts,
    idleCars,
    paperworkDue,
    workshopLate,
    licencesDue,
    reviewsWaiting,
    damage,
    bondsToRefund,
    vehicleWarningDays: settings.vehicleExpiryWarningDays,
  };
}
