import {
  formatAbn,
  formatCalendarDate,
  formatCents,
  formatDateTimeInTimeZone,
  operatorSettingsSchema,
  readSettings,
  RENTAL_TYPE_LABELS,
  renterDisplayName,
  todayInTimeZone,
  type ContractData,
  DAYS_PER_WEEK,
  WEEKDAY_LABELS,
  type Weekday,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { insurancePolicies, insurancePolicyVehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, gte, isNull, lte } from "drizzle-orm";

import { loadRental, type RentalDetail } from "../rentals/rental-queries";
import type { RentalClock } from "../rentals/rental-records";
import { loadRenter, type RenterDetail } from "../renters/renter-queries";
import { licenceIssuedInText } from "../renters/licence-text";
import { loadBusinessDetails, type BusinessDetails } from "../settings/business-details";
import { loadVehicle } from "../vehicles/vehicle-queries";
import { linksOfCar, POLICY_OF_LINK } from "../vehicles/policy-links";

const ONGOING_END_TEXT = "No end date (ongoing)";

/** "1 Example St, Unit 2, Perth WA 6000", or null when nothing is on file. */
function addressText(
  parts: readonly (string | null)[],
  place: readonly (string | null)[],
): string | null {
  const text = [...parts, place.filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return text === "" ? null : text;
}

/**
 * The excess of the policy covering the car on the day: its last day covered
 * too, as everywhere else (review A11-8).
 */
async function excessOnDay(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
  startDate: string,
): Promise<number | null> {
  const [policy] = await tx
    .select({ excessCents: insurancePolicies.excessCents })
    .from(insurancePolicyVehicles)
    .innerJoin(insurancePolicies, POLICY_OF_LINK)
    .where(
      and(
        linksOfCar(operatorId, vehicleId),
        isNull(insurancePolicyVehicles.removedAt),
        isNull(insurancePolicies.archivedAt),
        lte(insurancePolicies.startsOn, startDate),
        gte(insurancePolicies.endsOn, startDate),
      ),
    )
    .orderBy(desc(insurancePolicies.startsOn))
    .limit(1);
  return policy?.excessCents ?? null;
}

type FieldsOf<Group extends string> = Pick<
  ContractData,
  Extract<keyof ContractData, `${Group}${string}`>
>;

function businessFields(business: BusinessDetails): FieldsOf<"business"> {
  return {
    businessLegalName: business.legalName,
    businessTradingName: business.tradingName,
    businessAbn: business.abn ? formatAbn(business.abn) : null,
    businessAddress: addressText(
      [business.addressLine1, business.addressLine2],
      [business.suburb, business.state, business.postcode],
    ),
    businessPhone: business.phone,
    businessEmail: business.email,
  };
}

function renterFields(renter: RenterDetail): FieldsOf<"renter"> {
  return {
    renterFullName: renterDisplayName(renter.fullName, null),
    renterDateOfBirth: renter.dateOfBirth ? formatCalendarDate(renter.dateOfBirth) : null,
    renterAddress: renter.residentialAddress,
    renterPhone: renter.phone,
    renterEmail: renter.email,
    renterLicenceNumber: renter.licenceNumber,
    renterLicenceIssuedIn:
      licenceIssuedInText(renter.licenceIssuedIn, renter.licenceCountry) || null,
    renterLicenceExpires: renter.licenceExpiresOn
      ? formatCalendarDate(renter.licenceExpiresOn)
      : null,
  };
}

function rentalFields(
  rental: RentalDetail,
  clock: RentalClock,
  excessCents: number | null,
): Omit<ContractData, keyof FieldsOf<"business" | "renter" | "car" | "change" | "swap">> &
  Pick<ContractData, "insuranceExcess"> {
  const onClock = (moment: Date) => formatDateTimeInTimeZone(moment, clock.timeZone);
  // The rental's own settings (rule 14), not today's.
  const { ongoingNoticeDays } = readSettings(operatorSettingsSchema, rental.settingsSnapshot);
  return {
    rentalKind: RENTAL_TYPE_LABELS[rental.type],
    rentalStart: onClock(rental.plannedStart),
    rentalEnd: rental.plannedEnd ? onClock(rental.plannedEnd) : ONGOING_END_TEXT,
    weeklyRate: contractWeeklyRateText(rental),
    ...blockTermFields(rental),
    bond: formatCents(rental.bondCents),
    chargeDay: contractChargeText(rental),
    noticeDays: `${ongoingNoticeDays} ${ongoingNoticeDays === 1 ? "day" : "days"}`,
    insuranceExcess: excessCents === null ? null : formatCents(excessCents),
    issuedOn: formatCalendarDate(todayInTimeZone(clock.now, clock.timeZone)),
  };
}

/**
 * The weekly rate as a contract prints it after "Weekly rate": the long-term
 * weekly price (seven daily rates without one), so templates written before
 * rent in blocks still read correctly.
 */
function contractWeeklyRateText(rental: RentalDetail): string {
  const weekly =
    rental.weeklyRateCents ??
    (rental.dailyRateCents === null ? null : rental.dailyRateCents * DAYS_PER_WEEK);
  return weekly === null ? "" : formatCents(weekly);
}

/**
 * What follows "Rent is charged in advance each": the weekday for a rental
 * from before rent in blocks; else a week, or a day for a short hire,
 * counted from the time of the handover.
 */
function contractChargeText(rental: RentalDetail): string {
  if (rental.isLongTerm === null) {
    return WEEKDAY_LABELS[rental.chargeWeekday as Weekday];
  }
  return rental.isLongTerm
    ? "week, counted from the time of the handover"
    : "day, counted from the time of the handover";
}

/**
 * The block terms the Renter agrees to (docs/legal-notes.md): the daily rate,
 * the long-term price, when a rental counts as long-term, and the grace
 * period. None for a rental from before rent in blocks.
 */
function blockTermFields(
  rental: RentalDetail,
): Pick<ContractData, "dailyRate" | "longTermWeeklyRate" | "longTermMinimum" | "gracePeriod"> {
  if (rental.isLongTerm === null) {
    return { dailyRate: null, longTermWeeklyRate: null, longTermMinimum: null, gracePeriod: null };
  }
  const days = rental.longTermMinimumDays ?? 0;
  const minutes = rental.graceMinutes ?? 0;
  return {
    dailyRate: rental.dailyRateCents === null ? null : formatCents(rental.dailyRateCents),
    longTermWeeklyRate:
      rental.weeklyRateCents === null
        ? "7 days at the daily rate"
        : formatCents(rental.weeklyRateCents),
    longTermMinimum: `${days} ${days === 1 ? "day" : "days"} or more, or ongoing, is long-term`,
    gracePeriod: `${minutes} ${minutes === 1 ? "minute" : "minutes"}`,
  };
}

/**
 * Every merge field's text for one of the Operator's rentals, or null if
 * the rental is not theirs. Times are on the Operator's clock (rule 10).
 */
/** The change-of-terms fields, which only a change-of-terms form fills in. */
export type ChangeFields = FieldsOf<"change">;
/** The car swap fields, which only a swap form fills in. */
export type SwapFields = FieldsOf<"swap">;
/** The fields one kind of form fills in on top of the rental's own. */
export type FormOnlyFields = ChangeFields | SwapFields;

const NO_FORM_ONLY_FIELDS: ChangeFields & SwapFields = {
  changeSummary: null,
  changeReason: null,
  changeNewRate: null,
  changeRateFrom: null,
  changeNewEnd: null,
  swapOldCar: null,
  swapNewCar: null,
  swapAt: null,
  swapReason: null,
};

/**
 * What a document's fields say for this rental. The car is the rental's own,
 * or another named (a swap form's car going out: review G4-3); its excess is
 * the one on the day the document speaks from: the start, or the day it is
 * made once the car is out (a change after a swap).
 */
export async function loadContractData(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
  clock: RentalClock,
  car: { vehicleId?: string } = {},
): Promise<ContractData | null> {
  const rental = await loadRental(database, operatorId, rentalId, clock);
  if (!rental) {
    return null;
  }
  const vehicleId = car.vehicleId ?? rental.vehicleId;
  const startDate = todayInTimeZone(rental.plannedStart, clock.timeZone);
  const today = todayInTimeZone(clock.now, clock.timeZone);
  // Before the handover the contract speaks from the start; once out, from today.
  const isOut = rental.handedOverAt !== null && rental.handedOverAt <= clock.now;
  const excessDay = isOut && today > startDate ? today : startDate;
  const [renter, vehicle, business, excessCents] = await Promise.all([
    loadRenter(database, operatorId, rental.renterId),
    loadVehicle(database, operatorId, vehicleId),
    loadBusinessDetails(database, operatorId),
    withTenant(database, operatorId, (tx) => excessOnDay(tx, operatorId, vehicleId, excessDay)),
  ]);
  if (!renter || !vehicle || !business) {
    return null;
  }
  const data: ContractData = {
    ...businessFields(business),
    ...renterFields(renter),
    carRego: vehicle.rego,
    carMakeModel: `${vehicle.make} ${vehicle.model}`,
    carYear: String(vehicle.year),
    carVin: vehicle.vin,
    ...rentalFields(rental, clock, excessCents),
    ...NO_FORM_ONLY_FIELDS,
  };
  return data;
}
