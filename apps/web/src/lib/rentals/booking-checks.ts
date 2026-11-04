import {
  bookingProblems,
  canTakeStripePayments,
  isBondShortForHandover,
  isDirectDebitMissingForHandover,
  paymentAccountState,
  storedAccountStatus,
  operatorSettingsSchema,
  readSettings,
  todayInTimeZone,
  type BookingProblem,
  type OperatorSettings,
  type VehicleStatus,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { withTenant } from "@fleetapp/db/tenant-context";
import { files, renters, stripeAccounts, vehicles } from "@fleetapp/db/schema";
import { and, countDistinct, eq, isNull } from "drizzle-orm";

import { bondAccountOf, selectBondMovements } from "../bonds/bond-account";
import { licenceScanInUse } from "../files/stored-files";
import { rentalPaymentsIn } from "../payments/renter-payment-records";

/** Whether this site can send Renters to Stripe's page and hear back (app-payments). */
export interface PaymentsReach {
  canHearRenterPayments: boolean;
}

const NO_RENTER_PAYMENTS: PaymentsReach = { canHearRenterPayments: false };

/** Whether the business's Renters are offered Stripe's page: this site hears back, and its account is ready. */
async function isStripeOffered(
  tx: AnyTransaction,
  operatorId: string,
  reach: PaymentsReach,
): Promise<boolean> {
  if (!reach.canHearRenterPayments) {
    return false;
  }
  const [account] = await tx
    .select()
    .from(stripeAccounts)
    .where(eq(stripeAccounts.operatorId, operatorId));
  return (
    account !== undefined &&
    canTakeStripePayments(paymentAccountState(storedAccountStatus(account)))
  );
}

/** Both sides of a licence: front and back. */
const LICENCE_SIDE_COUNT = 2;

export interface BookingParties {
  renter: typeof renters.$inferSelect;
  carStatus: VehicleStatus;
}

type PartiesOrMissing = BookingParties | "renter_not_found" | "car_not_found";

/** The Operator's current Renter and car, or which one is missing. */
async function findBookingParties(
  tx: AnyTransaction,
  operatorId: string,
  ids: { renterId: string; vehicleId: string },
  shouldLock: boolean,
): Promise<PartiesOrMissing> {
  const carQuery = tx
    .select({ status: vehicles.status })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.id, ids.vehicleId),
        eq(vehicles.operatorId, operatorId),
        isNull(vehicles.archivedAt),
      ),
    );
  const [car] = shouldLock ? await carQuery.for("update") : await carQuery;
  if (!car) {
    return "car_not_found";
  }
  const renterQuery = tx
    .select()
    .from(renters)
    .where(
      and(
        eq(renters.id, ids.renterId),
        eq(renters.operatorId, operatorId),
        isNull(renters.archivedAt),
      ),
    );
  const [renter] = shouldLock ? await renterQuery.for("update") : await renterQuery;
  return renter ? { renter, carStatus: car.status } : "renter_not_found";
}

/**
 * The Operator's current Renter and car, both locked for this transaction:
 * the car so two bookings of it are made one after the other, the Renter so
 * their details cannot change under the checks. Otherwise, which one is missing.
 */
export function lockBookingParties(
  tx: AnyTransaction,
  operatorId: string,
  ids: { renterId: string; vehicleId: string },
): Promise<PartiesOrMissing> {
  return findBookingParties(tx, operatorId, ids, true);
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

/**
 * What still stands between a rental's Renter and its car (including bond
 * still to receive, when the rental's rules want it first), checked now under
 * the rules the rental was made with (rule 14). Nothing is locked: this is
 * for showing on the rental's page.
 */
export async function loadRentalProblems(
  database: AnyDatabase,
  operatorId: string,
  rental: {
    id: string;
    renterId: string;
    vehicleId: string;
    plannedStart: Date;
    plannedEnd: Date | null;
    bondCents: number;
    settingsSnapshot: Record<string, unknown>;
  },
  clock: { timeZone: string; now: Date },
  reach: PaymentsReach = NO_RENTER_PAYMENTS,
): Promise<BookingProblem[] | "renter_not_found" | "car_not_found"> {
  return withTenant(database, operatorId, async (tx) => {
    const parties = await findBookingParties(tx, operatorId, rental, false);
    if (typeof parties === "string") {
      return parties;
    }
    const settings = readSettings(operatorSettingsSchema, rental.settingsSnapshot);
    const period = { start: rental.plannedStart, end: rental.plannedEnd, ...clock };
    const problems = await findBookingProblems(tx, parties, period, settings);
    const bond = bondAccountOf(
      await selectBondMovements(tx, operatorId, rental.id),
      rental.bondCents,
    );
    const isBondShort = isBondShortForHandover({
      isRequiredBeforeHandover: settings.isBondRequiredBeforeHandover,
      requiredCents: rental.bondCents,
      heldCents: bond.heldCents,
    });
    const { directDebit } = await rentalPaymentsIn(tx, operatorId, rental);
    const isDirectDebitMissing = isDirectDebitMissingForHandover({
      isRequiredBeforeHandover: settings.isDirectDebitRequiredBeforeHandover,
      canTakeStripePayments: await isStripeOffered(tx, operatorId, reach),
      state: directDebit,
    });
    return [
      ...problems,
      ...(isBondShort
        ? [{ code: "bond_short", level: "handover", owingCents: bond.owingCents } as const]
        : []),
      ...(isDirectDebitMissing
        ? [{ code: "direct_debit_missing", level: "handover", state: directDebit } as const]
        : []),
    ];
  });
}
