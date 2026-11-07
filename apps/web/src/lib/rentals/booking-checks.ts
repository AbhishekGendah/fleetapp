import {
  bookingProblems,
  type BookingCheckInput,
  areRenterPaymentsOffered,
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
import {
  files,
  possessions,
  rentals,
  renters,
  stripeAccounts,
  vehicles,
} from "@fleetapp/db/schema";
import { and, countDistinct, eq, isNull, lt, ne } from "drizzle-orm";

import { bondAccountOf, selectBondMovements } from "../bonds/bond-account";
import { licenceScanInUse } from "../files/stored-files";
import { rentalPaymentsIn } from "../payments/renter-payment-records";
import { isInsuredOn, isRegisteredOn } from "../vehicles/expiry-columns";

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
  const [account] = await tx
    .select()
    .from(stripeAccounts)
    .where(eq(stripeAccounts.operatorId, operatorId));
  // Hearing back about Renters' payments is only set up where payments by Stripe are.
  return (
    account !== undefined &&
    areRenterPaymentsOffered({
      isSiteSetUp: reach.canHearRenterPayments,
      canHearRenterPayments: reach.canHearRenterPayments,
      state: paymentAccountState(storedAccountStatus(account)),
    })
  );
}

/** Both sides of a licence: front and back. */
const LICENCE_SIDE_COUNT = 2;

type RenterRow = typeof renters.$inferSelect;

export interface BookingParties {
  /** Who pays and signs the contract. */
  renter: RenterRow;
  /** Who drives: the Renter themselves for a person (the same row). */
  driver: RenterRow;
  vehicleId: string;
  carStatus: VehicleStatus;
}

/** What the car checks are for (review A6-3, A8-2). */
export interface CarCheck {
  /** The rental being checked, whose own time with the car never counts; none for a new booking. */
  rentalId: string | null;
  /**
   * True only as the car changes hands: then cover must be there today and
   * the car must be back. Otherwise cover is checked from the start, and only
   * a Renter overdue back is worth a warning (batch 7 decision 1).
   */
  isHandingOverNow: boolean;
}

type PartiesOrMissing = BookingParties | "renter_not_found" | "car_not_found";

/** Which Renter, driver and car: no driver named means the Renter drives (a person's own rental). */
interface PartyIds {
  renterId: string;
  driverId?: string | null;
  vehicleId: string;
}

/** One of the Operator's Renters, locked when asked; a current one only, unless an archived one is allowed. */
async function findRenter(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
  options: { shouldLock: boolean; isArchivedAllowed: boolean },
): Promise<RenterRow | undefined> {
  const query = tx
    .select()
    .from(renters)
    .where(
      and(
        eq(renters.id, renterId),
        eq(renters.operatorId, operatorId),
        options.isArchivedAllowed ? undefined : isNull(renters.archivedAt),
      ),
    );
  const [renter] = options.shouldLock ? await query.for("update") : await query;
  return renter;
}

/**
 * Who drives: a person drives their own rentals. A business's driver is
 * whoever the rental names, which the database holds to one of its current
 * drivers. Naming one (and telling an archived one apart) comes with renting
 * to a business (plan slice 3); until then a business has no driver here.
 */
async function findDriver(
  tx: AnyTransaction,
  operatorId: string,
  renter: RenterRow,
  ids: PartyIds,
  shouldLock: boolean,
): Promise<RenterRow | undefined> {
  if (renter.kind === "person" || !ids.driverId) {
    return renter.kind === "person" ? renter : undefined;
  }
  return findRenter(tx, operatorId, ids.driverId, { shouldLock, isArchivedAllowed: true });
}

/** The Operator's current Renter, their driver and the car, or which one is missing. */
async function findBookingParties(
  tx: AnyTransaction,
  operatorId: string,
  ids: PartyIds,
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
  const renter = await findRenter(tx, operatorId, ids.renterId, {
    shouldLock,
    isArchivedAllowed: false,
  });
  const driver = renter ? await findDriver(tx, operatorId, renter, ids, shouldLock) : undefined;
  return renter && driver
    ? { renter, driver, vehicleId: ids.vehicleId, carStatus: car.status }
    : "renter_not_found";
}

/**
 * The Operator's current Renter, their driver and the car, all locked for
 * this transaction (car, then Renter, then driver): the car so two bookings
 * of it are made one after the other, the Renter and driver so their details
 * cannot change under the checks. Otherwise, which one is missing.
 */
export function lockBookingParties(
  tx: AnyTransaction,
  operatorId: string,
  ids: PartyIds,
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

/** Whether another rental's Renter still has the car: any time at handover, otherwise only past their end. */
async function isCarOutWithAnotherRenter(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
  check: CarCheck & { now: Date },
): Promise<boolean> {
  const [out] = await tx
    .select({ id: possessions.id })
    .from(possessions)
    .innerJoin(
      rentals,
      and(eq(rentals.id, possessions.rentalId), eq(rentals.operatorId, possessions.operatorId)),
    )
    .where(
      and(
        eq(possessions.operatorId, operatorId),
        eq(possessions.vehicleId, vehicleId),
        isNull(possessions.endedAt),
        check.rentalId ? ne(possessions.rentalId, check.rentalId) : undefined,
        check.isHandingOverNow ? undefined : lt(rentals.plannedEnd, check.now),
      ),
    )
    .limit(1);
  return out !== undefined;
}

/** The car's insurance and rego on that day, and whether it is still out with someone else. */
async function findCarFacts(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
  check: CarCheck & { now: Date; coverOn: string },
): Promise<BookingCheckInput["car"]> {
  const [cover] = await tx
    .select({ isInsured: isInsuredOn(check.coverOn), isRegistered: isRegisteredOn(check.coverOn) })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.operatorId, operatorId)));
  return {
    isInsured: cover?.isInsured ?? false,
    isRegistered: cover?.isRegistered ?? false,
    isOutWithAnotherRenter: await isCarOutWithAnotherRenter(tx, operatorId, vehicleId, check),
  };
}

/** What stands between this Renter, their driver and this car for these dates, on the Operator's clock. */
export async function findBookingProblems(
  tx: AnyTransaction,
  parties: BookingParties,
  period: { start: Date; end: Date | null; timeZone: string; now: Date },
  settings: Pick<OperatorSettings, "minimumRenterAgeYears" | "isProvisionalLicenceAllowed">,
  check: CarCheck,
): Promise<BookingProblem[]> {
  const { renter, driver } = parties;
  const dateOf = (moment: Date): string => todayInTimeZone(moment, period.timeZone);
  const today = dateOf(period.now);
  const startDate = dateOf(period.start);
  // The car must be covered from the day it goes: today once it is going, else its start.
  const coverOn = check.isHandingOverNow || startDate < today ? today : startDate;
  const car = await findCarFacts(tx, renter.operatorId, parties.vehicleId, {
    ...check,
    now: period.now,
    coverOn,
  });
  return bookingProblems({
    renter: { status: renter.status },
    // The licence and its scans are the driver's.
    driver: {
      status: driver.status,
      dateOfBirth: driver.dateOfBirth,
      residentialAddress: driver.residentialAddress,
      licenceType: driver.licenceType,
      licenceExpiresOn: driver.licenceExpiresOn,
      hasBothLicenceScans: await hasBothLicenceScans(tx, driver.operatorId, driver.id),
    },
    carStatus: parties.carStatus,
    car,
    coverOn,
    startDate,
    endDate: period.end === null ? null : dateOf(period.end),
    today,
    rules: settings,
  });
}

/**
 * What still stands between a rental's Renter, its driver and its car (including bond
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
    driverId: string | null;
    vehicleId: string;
    plannedStart: Date;
    plannedEnd: Date | null;
    bondCents: number;
    settingsSnapshot: Record<string, unknown>;
  },
  clock: { timeZone: string; now: Date },
  reach: PaymentsReach = NO_RENTER_PAYMENTS,
  /** Only the handover itself checks as the car changes hands. */
  isHandingOverNow = false,
): Promise<BookingProblem[] | "renter_not_found" | "car_not_found"> {
  return withTenant(database, operatorId, async (tx) => {
    const parties = await findBookingParties(tx, operatorId, rental, false);
    if (typeof parties === "string") {
      return parties;
    }
    const settings = readSettings(operatorSettingsSchema, rental.settingsSnapshot);
    const period = { start: rental.plannedStart, end: rental.plannedEnd, ...clock };
    const problems = await findBookingProblems(tx, parties, period, settings, {
      rentalId: rental.id,
      isHandingOverNow,
    });
    const bond = bondAccountOf(
      await selectBondMovements(tx, operatorId, rental.id),
      rental.bondCents,
    );
    const isBondShort = isBondShortForHandover({
      isRequiredBeforeHandover: settings.isBondRequiredBeforeHandover,
      requiredCents: rental.bondCents,
      heldCents: bond.heldCents,
    });
    const { directDebit, bond: stripeBond } = await rentalPaymentsIn(tx, operatorId, rental);
    const isDirectDebitMissing = isDirectDebitMissingForHandover({
      isRequiredBeforeHandover: settings.isDirectDebitRequiredBeforeHandover,
      canTakeStripePayments: await isStripeOffered(tx, operatorId, reach),
      state: directDebit,
    });
    return [
      ...problems,
      ...(isBondShort
        ? [
            {
              code: "bond_short",
              level: "handover",
              owingCents: bond.owingCents,
              onItsWayCents: stripeBond.pendingCents,
            } as const,
          ]
        : []),
      ...(isDirectDebitMissing
        ? [{ code: "direct_debit_missing", level: "handover", state: directDebit } as const]
        : []),
    ];
  });
}
