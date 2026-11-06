import type { VehicleStatus } from "@fleetapp/core";

import { appDb } from "../app-db";
import { canHearRenterPayments } from "../payments/app-payments";
import type { SignedInUser } from "../require-user";
import { loadAttentionSources, type AttentionSources } from "./attention-sources";
import { DASHBOARD_LIST_LENGTH, loadFleetCounts } from "./fleet-overview";

export interface DashboardData extends AttentionSources {
  fleetCounts: Partial<Record<VehicleStatus, number>>;
}

/** Everything the dashboard shows for the signed-in User's Operator, loaded together. */
export async function loadDashboard(user: SignedInUser): Promise<DashboardData> {
  const clock = { timeZone: user.operatorTimezone, now: new Date() };
  const [sources, fleetCounts] = await Promise.all([
    // The top few of each kind are enough to pick the most urgent of all.
    loadAttentionSources(appDb, user.operatorId, {
      clock,
      limitPerKind: DASHBOARD_LIST_LENGTH,
      reach: { canHearRenterPayments },
    }),
    loadFleetCounts(appDb, user.operatorId),
  ]);
  return { ...sources, fleetCounts };
}
