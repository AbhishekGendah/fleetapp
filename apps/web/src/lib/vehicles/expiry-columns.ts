import { expiryStatus, type ExpiryStatus } from "@fleetapp/core";
import {
  insurancePolicies,
  insurancePolicyVehicles,
  vehicleRegistrations,
  vehicles,
} from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { sql } from "drizzle-orm";

const ofThisCarsRegos = sql`${qualified(vehicleRegistrations.vehicleId)} = ${qualified(vehicles.id)} and ${qualified(vehicleRegistrations.archivedAt)} is null`;

/** The car is on a monthly direct debit that has not been stopped: registered, with no expiry. */
export const isRegoOnDirectDebit = sql<boolean>`exists (
  select 1 from ${vehicleRegistrations}
  where ${ofThisCarsRegos}
    and ${qualified(vehicleRegistrations.expiresOn)} is null
    and ${qualified(vehicleRegistrations.directDebitStoppedOn)} is null
)`;

/**
 * The expiry of the car's current rego: its renewal that runs latest. None
 * while a direct debit is running, as that has no expiry.
 */
export const currentRegoExpiresOn = sql<string | null>`(
  case when ${isRegoOnDirectDebit} then null else (
    select max(${qualified(vehicleRegistrations.expiresOn)}) from ${vehicleRegistrations}
    where ${ofThisCarsRegos}
  ) end
)`;

/** When the car's cover ends: the latest-ending policy it is on now. */
export const currentInsuranceEndsOn = sql<string | null>`(
  select max(${qualified(insurancePolicies.endsOn)}) from ${insurancePolicyVehicles}
  join ${insurancePolicies} on ${qualified(insurancePolicies.id)} = ${qualified(insurancePolicyVehicles.policyId)}
  where ${qualified(insurancePolicyVehicles.vehicleId)} = ${qualified(vehicles.id)}
    and ${qualified(insurancePolicyVehicles.removedAt)} is null
    and ${qualified(insurancePolicies.archivedAt)} is null
)`;

/** What "today" and "due soon" mean for this Operator, for the badges. */
export interface ExpiryContext {
  today: string;
  warningDays: number;
}

export interface ExpiryDates {
  isRegoOnDirectDebit: boolean;
  regoExpiresOn: string | null;
  insuranceEndsOn: string | null;
}

export type WithExpiryStatuses<Row extends ExpiryDates> = Row & {
  regoStatus: ExpiryStatus;
  insuranceStatus: ExpiryStatus;
};

/** Adds the rego and insurance badges' statuses to each row. */
export function withExpiryStatuses<Row extends ExpiryDates>(
  rows: readonly Row[],
  context: ExpiryContext,
): WithExpiryStatuses<Row>[] {
  return rows.map((row) => ({
    ...row,
    regoStatus: expiryStatus(row.regoExpiresOn, context.today, context.warningDays),
    insuranceStatus: expiryStatus(row.insuranceEndsOn, context.today, context.warningDays),
  }));
}
