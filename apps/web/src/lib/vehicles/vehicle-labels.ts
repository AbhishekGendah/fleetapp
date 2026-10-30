import {
  BODY_TYPE_LABELS,
  formatCalendarDate,
  formatCents,
  formatDateTimeInTimeZone,
  PURCHASE_SOURCE_LABELS,
  VEHICLE_COST_KIND_LABELS,
  WITHHELD_VALUE,
  FUEL_TYPE_LABELS,
  INSURANCE_COVER_TYPE_LABELS,
  TRANSMISSION_LABELS,
  VEHICLE_STATUS_LABELS,
} from "@fleetapp/core";

import type { CostFormField, PurchaseFormField, SaleFormField } from "./cost-input";
import type { PolicyFormField, RegoFormField } from "./paperwork-input";
import type { VehicleFormField } from "./vehicle-input";

type VehicleLabelledField =
  | VehicleFormField
  | "status"
  | "statusReason"
  | "statusExpectedBack"
  | PolicyFormField
  | RegoFormField
  | PurchaseFormField
  | SaleFormField
  | CostFormField;

/** What each car field is called, on the form and in the car's history. */
export const VEHICLE_FIELD_LABELS: Readonly<Record<VehicleLabelledField, string>> = {
  rego: "Rego",
  regoState: "State",
  make: "Make",
  model: "Model",
  variant: "Variant",
  year: "Year",
  colour: "Colour",
  bodyType: "Body type",
  transmission: "Transmission",
  fuelType: "Fuel",
  seats: "Seats",
  vin: "VIN",
  kilometres: "Odometer (km)",
  status: "Status",
  statusReason: "Reason",
  statusExpectedBack: "Expected back",
  state: "State",
  termMonths: "Term (months)",
  expiresOn: "Expires",
  paidOn: "Paid on",
  costCents: "Cost",
  gstCents: "GST",
  insurer: "Insurer",
  policyNumber: "Policy number",
  coverType: "Cover",
  startsOn: "Starts",
  endsOn: "Ends",
  excessCents: "Excess",
  purchasedOn: "Bought on",
  source: "Bought from",
  sellerName: "Seller's name",
  sellerPhone: "Seller's phone",
  sellerAddress: "Seller's address",
  priceCents: "Price",
  soldAt: "Handed over",
  buyerName: "Buyer's name",
  buyerPhone: "Buyer's phone",
  buyerAddress: "Buyer's address",
  buyerLicenceNumber: "Buyer's licence number",
  buyerLicenceState: "Licence state",
  transferLodgedOn: "Transfer lodged on",
  transferReference: "Transfer reference",
  incurredOn: "Date",
  kind: "Kind",
  description: "Description",
};

const DATE_FIELDS: readonly string[] = [
  "statusExpectedBack",
  "expiresOn",
  "paidOn",
  "startsOn",
  "endsOn",
  "purchasedOn",
  "transferLodgedOn",
  "incurredOn",
];
const MONEY_FIELDS: readonly string[] = ["costCents", "gstCents", "excessCents", "priceCents"];
/** Moments, kept in UTC and shown on the Operator's clock. */
const MOMENT_FIELDS: readonly string[] = ["soldAt"];

/** Stored values that read differently on screen. */
const VALUE_LABELS: Partial<Record<VehicleLabelledField, Readonly<Record<string, string>>>> = {
  status: VEHICLE_STATUS_LABELS,
  bodyType: BODY_TYPE_LABELS,
  transmission: TRANSMISSION_LABELS,
  fuelType: FUEL_TYPE_LABELS,
  coverType: INSURANCE_COVER_TYPE_LABELS,
  source: PURCHASE_SOURCE_LABELS,
  kind: VEHICLE_COST_KIND_LABELS,
};

function isLabelledField(field: string): field is VehicleLabelledField {
  return Object.hasOwn(VEHICLE_FIELD_LABELS, field);
}

/**
 * A stored car or paperwork value in words: "In service", "1 Nov 2026",
 * "$912.50" or "blank". A moment needs the Operator's timezone to be shown.
 */
export function describeVehicleValue(field: string, value: unknown, timeZone?: string): string {
  if (value === null || value === undefined || value === "") {
    return "blank";
  }
  if (value === WITHHELD_VALUE) {
    return "not shown";
  }
  if (MOMENT_FIELDS.includes(field) && timeZone && typeof value === "string") {
    return formatDateTimeInTimeZone(new Date(value), timeZone);
  }
  if (MONEY_FIELDS.includes(field) && typeof value === "number") {
    return formatCents(value);
  }
  const text = String(value);
  if (DATE_FIELDS.includes(field)) {
    return formatCalendarDate(text);
  }
  return (isLabelledField(field) ? VALUE_LABELS[field]?.[text] : undefined) ?? text;
}

export function vehicleFieldLabel(field: string): string {
  return isLabelledField(field) ? VEHICLE_FIELD_LABELS[field] : field;
}
