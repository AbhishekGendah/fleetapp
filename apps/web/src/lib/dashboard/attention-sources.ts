import { dashboardWindow, type DashboardWindow } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";

import { loadOpenDamage, type DamageOnDashboard } from "../damage/damage-queries";
import type { PaymentsReach } from "../rentals/booking-checks";
import type { RentalClock } from "../rentals/rental-records";
import { loadOperatorSettings } from "../settings/operator-settings";
import { loadBondsToRefund, type BondToRefund } from "./bonds-to-refund";
import { loadOverdueRentals, type OverdueRental } from "./overdue-rentals";
import {
  loadLicencesDue,
  loadPaperworkDue,
  loadReviewsWaiting,
  loadWorkshopLate,
  type CarInWorkshop,
  type CarPaperworkDue,
  type FewOfMany,
  type RenterDetailsWaiting,
  type RenterLicenceDue,
} from "./fleet-overview";
import {
  loadBookingReadiness,
  loadRentalsThisWeek,
  type BookingReadiness,
  type RentalThisWeek,
} from "./rentals-this-week";

/** Everything Needs attention is made from, each kind as loaded (its first so many, and its total). */
export interface AttentionSources {
  window: DashboardWindow;
  /** Rentals with money owing past the business's grace days, longest late first. */
  overduePayments: FewOfMany<OverdueRental>;
  /** This week's rentals: the overdue and late ones, and today's and the week's moments. */
  rentals: RentalThisWeek[];
  notReady: BookingReadiness[];
  paperworkDue: FewOfMany<CarPaperworkDue>;
  workshopLate: FewOfMany<CarInWorkshop>;
  licencesDue: FewOfMany<RenterLicenceDue>;
  reviewsWaiting: FewOfMany<RenterDetailsWaiting>;
  openDamage: FewOfMany<DamageOnDashboard>;
  bondsToRefund: FewOfMany<BondToRefund>;
  vehicleWarningDays: number;
}

/**
 * Each kind of thing needing attention, for one Operator, every query
 * scoped to them inside their tenant context. `limitPerKind` is how many of
 * each kind to load: the dashboard needs only its top few of each to pick
 * the most urgent overall; the full page loads them all.
 */
export async function loadAttentionSources(
  database: AnyDatabase,
  operatorId: string,
  request: { clock: RentalClock; limitPerKind: number; reach?: PaymentsReach },
): Promise<AttentionSources> {
  const { clock, limitPerKind } = request;
  const window = dashboardWindow(clock.now, clock.timeZone);
  const settings = await loadOperatorSettings(database, operatorId);
  const vehicleExpiry = { today: window.today, warningDays: settings.vehicleExpiryWarningDays };
  const licenceExpiry = { today: window.today, warningDays: settings.licenceExpiryWarningDays };
  // Today's setting, not a rental's copy: Needs attention only shows things (rule 14 is for charging).
  const overdueRequest = {
    today: window.today,
    graceDays: settings.paymentGraceDays,
    limit: limitPerKind,
  };
  const [
    overduePayments,
    rentals,
    paperworkDue,
    workshopLate,
    licencesDue,
    reviewsWaiting,
    openDamage,
    bonds,
  ] = await Promise.all([
    loadOverdueRentals(database, operatorId, overdueRequest),
    loadRentalsThisWeek(database, operatorId, window, clock),
    loadPaperworkDue(database, operatorId, vehicleExpiry, limitPerKind),
    loadWorkshopLate(database, operatorId, window.today, limitPerKind),
    loadLicencesDue(database, operatorId, licenceExpiry, limitPerKind),
    loadReviewsWaiting(database, operatorId, limitPerKind),
    loadOpenDamage(database, operatorId, limitPerKind),
    loadBondsToRefund(database, operatorId, limitPerKind),
  ]);
  const notReady = await loadBookingReadiness(database, operatorId, rentals, clock, request.reach);
  return {
    window,
    overduePayments,
    rentals,
    notReady,
    paperworkDue,
    workshopLate,
    licencesDue,
    reviewsWaiting,
    openDamage,
    bondsToRefund: bonds,
    vehicleWarningDays: settings.vehicleExpiryWarningDays,
  };
}
