import { digitsOnly, formatWholeNumberAsTyped } from "./text";

/**
 * The rules for an Operator's cars (docs/design/02). Pure: the form checks
 * them as you type and the server checks them again on save.
 */

/**
 * What a car is doing. "rented" arrives with rentals (Phase 3) and is only
 * ever set by the system, from who has the car.
 */
export const VEHICLE_STATUSES = ["available", "in_service", "off_road", "sold", "written_off"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_STATUS_LABELS: Readonly<Record<VehicleStatus, string>> = {
  available: "Available",
  in_service: "In service",
  off_road: "Off road",
  sold: "Sold",
  written_off: "Written off",
};

/** Off the road for a while: these need a reason and an expected return date. */
const STATUSES_WITH_RETURN_DATE: readonly VehicleStatus[] = ["in_service", "off_road"];

/** Takes any text, as a form's status box holds it before it is checked. */
export function needsReturnDate(status: string): boolean {
  return (STATUSES_WITH_RETURN_DATE as readonly string[]).includes(status);
}

export const BODY_TYPES = [
  "sedan",
  "hatch",
  "wagon",
  "suv",
  "ute",
  "van",
  "people_mover",
  "coupe",
  "convertible",
] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const BODY_TYPE_LABELS: Readonly<Record<BodyType, string>> = {
  sedan: "Sedan",
  hatch: "Hatch",
  wagon: "Wagon",
  suv: "SUV",
  ute: "Ute",
  van: "Van",
  people_mover: "People mover",
  coupe: "Coupe",
  convertible: "Convertible",
};

export const TRANSMISSIONS = ["automatic", "manual"] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];

export const TRANSMISSION_LABELS: Readonly<Record<Transmission, string>> = {
  automatic: "Automatic",
  manual: "Manual",
};

export const FUEL_TYPES = ["petrol", "diesel", "hybrid", "plug_in_hybrid", "electric", "lpg"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const FUEL_TYPE_LABELS: Readonly<Record<FuelType, string>> = {
  petrol: "Petrol",
  diesel: "Diesel",
  hybrid: "Hybrid",
  plug_in_hybrid: "Plug-in hybrid",
  electric: "Electric",
  lpg: "LPG",
};

/** Longer than any Australian plate, personalised ones included. */
export const MAXIMUM_REGO_LENGTH = 9;

/**
 * Regos are compared without spaces, dots or dashes, in capitals, so
 * "1abc 234" and "1ABC234" are the same car.
 */
export function normaliseRego(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const VIN_LENGTH = 17;
/** 17 letters and digits; never I, O or Q, which look like 1 and 0. */
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normaliseVin(raw: string): string {
  return raw.toUpperCase().replace(/\s/g, "");
}

/** A VIN box as it is typed: capitals, no spaces, never longer than a VIN. */
export function typedVin(raw: string): string {
  return normaliseVin(raw).slice(0, VIN_LENGTH);
}

/** A whole-number box with a few digits (a year, a seat count): digits only, cut to length. */
export function typedDigits(raw: string, maximumDigits: number): string {
  return digitsOnly(raw).slice(0, maximumDigits);
}

export const YEAR_DIGITS = 4;
export const MAXIMUM_SEAT_DIGITS = 2;

export function isValidVin(vin: string): boolean {
  return VIN_PATTERN.test(normaliseVin(vin));
}

/** Older than this is a classic, not a rental. */
export const EARLIEST_VEHICLE_YEAR = 1950;
/** Next year's models go on sale during this year. */
const MODEL_YEARS_AHEAD = 1;

export function latestVehicleYear(today: Date): number {
  return today.getUTCFullYear() + MODEL_YEARS_AHEAD;
}

export const MAXIMUM_SEATS = 15;

/** Well past any car's life, so a slip of an extra digit is caught. */
export const MAXIMUM_ODOMETER_KM = 2_000_000;

export interface OdometerReadingForCheck {
  id: string;
  kilometres: number;
}

/**
 * The readings lower than the one before: a typing slip, a replaced
 * odometer, or tampering. Flagged for the Operator to look at, never refused.
 * Expects the readings oldest first.
 */
export function findOdometerDrops(readings: readonly OdometerReadingForCheck[]): Set<string> {
  return new Set(
    readings
      .filter((reading, index) => index > 0 && reading.kilometres < readings[index - 1]!.kilometres)
      .map((reading) => reading.id),
  );
}

/** How long a rego renewal runs. */
export const REGO_TERMS_MONTHS = [3, 6, 12] as const;
export type RegoTermMonths = (typeof REGO_TERMS_MONTHS)[number];

/** The kinds of car insurance sold in Australia. */
export const INSURANCE_COVER_TYPES = [
  "comprehensive",
  "third_party_fire_theft",
  "third_party_property",
] as const;
export type InsuranceCoverType = (typeof INSURANCE_COVER_TYPES)[number];

export const INSURANCE_COVER_TYPE_LABELS: Readonly<Record<InsuranceCoverType, string>> = {
  comprehensive: "Comprehensive",
  third_party_fire_theft: "Third party, fire and theft",
  third_party_property: "Third party property",
};

/** The most digits an odometer reading can have (2,000,000 km). */
export const MAXIMUM_ODOMETER_DIGITS = String(MAXIMUM_ODOMETER_KM).length;

/** An odometer box as it is typed: "48210" shows as "48,210". */
export function formatKilometresAsTyped(raw: string): string {
  return formatWholeNumberAsTyped(raw, MAXIMUM_ODOMETER_DIGITS);
}
