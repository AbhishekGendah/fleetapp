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
  WEEKDAY_LABELS,
  type ContractData,
  type Weekday,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { insurancePolicies, insurancePolicyVehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, gt, isNull, lte } from "drizzle-orm";

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

/** The excess of the policy covering the car on the day the rental starts. */
async function excessOnStart(
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
        gt(insurancePolicies.endsOn, startDate),
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
): Omit<ContractData, keyof FieldsOf<"business" | "renter" | "car" | "change">> &
  Pick<ContractData, "insuranceExcess"> {
  const onClock = (moment: Date) => formatDateTimeInTimeZone(moment, clock.timeZone);
  // The rental's own settings (rule 14), not today's.
  const { ongoingNoticeDays } = readSettings(operatorSettingsSchema, rental.settingsSnapshot);
  return {
    rentalKind: RENTAL_TYPE_LABELS[rental.type],
    rentalStart: onClock(rental.plannedStart),
    rentalEnd: rental.plannedEnd ? onClock(rental.plannedEnd) : ONGOING_END_TEXT,
    weeklyRate: formatCents(rental.weeklyRateCents),
    bond: formatCents(rental.bondCents),
    chargeDay: WEEKDAY_LABELS[rental.chargeWeekday as Weekday],
    noticeDays: `${ongoingNoticeDays} ${ongoingNoticeDays === 1 ? "day" : "days"}`,
    insuranceExcess: excessCents === null ? null : formatCents(excessCents),
    issuedOn: formatCalendarDate(todayInTimeZone(clock.now, clock.timeZone)),
  };
}

/**
 * Every merge field's text for one of the Operator's rentals, or null if
 * the rental is not theirs. Times are on the Operator's clock (rule 10).
 */
/** The change-of-terms fields, which only a change-of-terms form fills in. */
export type ChangeFields = FieldsOf<"change">;

export const NO_CHANGE_FIELDS: ChangeFields = {
  changeSummary: null,
  changeReason: null,
  changeNewRate: null,
  changeRateFrom: null,
  changeNewEnd: null,
};

export async function loadContractData(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
  clock: RentalClock,
): Promise<ContractData | null> {
  const rental = await loadRental(database, operatorId, rentalId, clock);
  if (!rental) {
    return null;
  }
  const startDate = todayInTimeZone(rental.plannedStart, clock.timeZone);
  const [renter, vehicle, business, excessCents] = await Promise.all([
    loadRenter(database, operatorId, rental.renterId),
    loadVehicle(database, operatorId, rental.vehicleId),
    loadBusinessDetails(database, operatorId),
    withTenant(database, operatorId, (tx) =>
      excessOnStart(tx, operatorId, rental.vehicleId, startDate),
    ),
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
    ...NO_CHANGE_FIELDS,
  };
  return data;
}
