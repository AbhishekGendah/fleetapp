import {
  bookingProblems,
  businessDetailsStillNeeded,
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
import { files, rentals, renters, stripeAccounts, vehicles } from "@fleetapp/db/schema";
import { and, asc, countDistinct, eq, isNull, ne } from "drizzle-orm";

import { bondAccountOf, selectBondMovements } from "../bonds/bond-account";
import { licenceScanInUse } from "../files/stored-files";
import { rentalPaymentsIn } from "../payments/renter-payment-records";
import { currentLinkOf } from "../renters/organisation-driver-records";
import { isInsuredOn, isRegisteredOn } from "../vehicles/expiry-columns";
import { findCarOutWithAnother } from "./car-holds";

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
  /** Who drives: the Renter themselves for a person (the same row); none while a business's is to be named. */
  driver: RenterRow | null;
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

/**
 * Why the parties can't be found: the Renter or car gone, or a business's
 * named driver archived (restored first), no longer its driver, or gone.
 */
export type MissingParty =
  | "renter_not_found"
  | "car_not_found"
  | "driver_not_found"
  | "driver_archived"
  | "driver_not_current";

type PartiesOrMissing = BookingParties | MissingParty;

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
 * whoever the rental names (none while to be named, decision 2): a person,
 * current, and one of its current drivers, read after the business (its
 * lock is what a driver's removal waits on: slice 1 review F2).
 */
async function findDriver(
  tx: AnyTransaction,
  operatorId: string,
  renter: RenterRow,
  ids: Omit<PartyIds, "vehicleId">,
  shouldLock: boolean,
): Promise<RenterRow | null | MissingParty> {
  if (renter.kind === "person") {
    return renter;
  }
  if (!ids.driverId) {
    return null;
  }
  const driver = await findRenter(tx, operatorId, ids.driverId, {
    shouldLock,
    isArchivedAllowed: true,
  });
  if (!driver || driver.kind !== "person" || driver.retiredAt) {
    return "driver_not_found";
  }
  if (driver.archivedAt) {
    return "driver_archived";
  }
  // Read, not locked: the rental naming them takes the link shared (the database's rule).
  return (await currentLinkOf(tx, operatorId, renter.id, driver.id, false))
    ? driver
    : "driver_not_current";
}

/** The Operator's current Renter and their driver, locked when asked (Renter, then driver). */
async function findRenterAndDriver(
  tx: AnyTransaction,
  operatorId: string,
  ids: Omit<PartyIds, "vehicleId">,
  shouldLock: boolean,
): Promise<Pick<BookingParties, "renter" | "driver"> | MissingParty> {
  const renter = await findRenter(tx, operatorId, ids.renterId, {
    shouldLock,
    isArchivedAllowed: false,
  });
  if (!renter) {
    return "renter_not_found";
  }
  const driver = await findDriver(tx, operatorId, renter, ids, shouldLock);
  return typeof driver === "string" ? driver : { renter, driver };
}

/** The car's status, locked when asked; none once it is archived. */
async function findCarStatus(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
  shouldLock: boolean,
): Promise<VehicleStatus | undefined> {
  const carQuery = tx
    .select({ status: vehicles.status })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.id, vehicleId),
        eq(vehicles.operatorId, operatorId),
        isNull(vehicles.archivedAt),
      ),
    );
  const [car] = shouldLock ? await carQuery.for("update") : await carQuery;
  return car?.status;
}

/** The Operator's current Renter, their driver and the car, or which one is missing. */
async function findBookingParties(
  tx: AnyTransaction,
  operatorId: string,
  ids: PartyIds,
  shouldLock: boolean,
): Promise<PartiesOrMissing> {
  const carStatus = await findCarStatus(tx, operatorId, ids.vehicleId, shouldLock);
  if (!carStatus) {
    return "car_not_found";
  }
  const people = await findRenterAndDriver(tx, operatorId, ids, shouldLock);
  return typeof people === "string" ? people : { ...people, vehicleId: ids.vehicleId, carStatus };
}

/**
 * For naming a business's driver on a draft or booking: the business, then
 * the driver, locked (the order a handover takes them, before the rental),
 * and the car as it is, unlocked (nothing about the car changes).
 */
export async function lockDriverNamingParties(
  tx: AnyTransaction,
  operatorId: string,
  ids: PartyIds,
): Promise<PartiesOrMissing> {
  const people = await findRenterAndDriver(tx, operatorId, ids, true);
  if (typeof people === "string") {
    return people;
  }
  const carStatus = await findCarStatus(tx, operatorId, ids.vehicleId, false);
  return carStatus ? { ...people, vehicleId: ids.vehicleId, carStatus } : "car_not_found";
}

/**
 * The Operator's current Renter, their driver and the car, all locked for
 * this transaction (car, then Renter, then driver): the car so two bookings
 * of it are made one after the other, the Renter and driver so their details
 * cannot change under the checks; a business's driver link is then taken
 * shared by the database as the rental names them. Otherwise, which one is
 * missing.
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
  const out = await findCarOutWithAnother(tx, operatorId, vehicleId, check.rentalId);
  if (!out) {
    return false;
  }
  return check.isHandingOverNow || (out.dueBack !== null && out.dueBack < check.now);
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

/**
 * The regos of other cars a business's driver has out now, theirs or another
 * business's: worth a warning, never a refusal (plan, "Booking").
 */
async function otherCarsOutWith(
  tx: AnyTransaction,
  driver: RenterRow,
  rentalId: string | null,
): Promise<string[]> {
  const rows = await tx
    .select({ rego: vehicles.rego })
    .from(rentals)
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, rentals.vehicleId), eq(vehicles.operatorId, rentals.operatorId)),
    )
    .where(
      and(
        eq(rentals.operatorId, driver.operatorId),
        eq(rentals.driverId, driver.id),
        eq(rentals.status, "active"),
        rentalId ? ne(rentals.id, rentalId) : undefined,
      ),
    )
    .orderBy(asc(vehicles.rego));
  return rows.map((row) => row.rego);
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
    renter: {
      status: renter.status,
      businessDetailsMissing:
        renter.kind === "organisation" ? businessDetailsStillNeeded(renter) : [],
    },
    // The licence and its scans are the driver's.
    driver: driver
      ? {
          status: driver.status,
          dateOfBirth: driver.dateOfBirth,
          residentialAddress: driver.residentialAddress,
          licenceType: driver.licenceType,
          licenceExpiresOn: driver.licenceExpiresOn,
          hasBothLicenceScans: await hasBothLicenceScans(tx, driver.operatorId, driver.id),
        }
      : null,
    driverOtherCarsOut:
      driver && renter.kind === "organisation"
        ? await otherCarsOutWith(tx, driver, check.rentalId)
        : [],
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
): Promise<BookingProblem[] | MissingParty> {
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
