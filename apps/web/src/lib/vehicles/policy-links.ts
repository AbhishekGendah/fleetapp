import { insurancePolicies, insurancePolicyVehicles } from "@fleetapp/db/schema";
import { and, eq, type SQL } from "drizzle-orm";

/** A car's link to a policy, joined to that policy within the same business. */
export const POLICY_OF_LINK = and(
  eq(insurancePolicies.id, insurancePolicyVehicles.policyId),
  eq(insurancePolicies.operatorId, insurancePolicyVehicles.operatorId),
);

/** The links of one of the business's cars to its policies, current or past. */
export function linksOfCar(operatorId: string, vehicleId: string): SQL | undefined {
  return and(
    eq(insurancePolicyVehicles.operatorId, operatorId),
    eq(insurancePolicyVehicles.vehicleId, vehicleId),
  );
}
