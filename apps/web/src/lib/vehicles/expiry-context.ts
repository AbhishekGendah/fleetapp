import { todayInTimeZone } from "@fleetapp/core";

import { appDb } from "../app-db";
import type { SignedInUser } from "../require-user";
import { loadOperatorSettings } from "../settings/operator-settings";
import type { WarningDaysSetting } from "../settings/number-setting-input";
import type { ExpiryContext } from "./expiry-columns";

/**
 * Today where the Operator is, and their "due soon" window, for the expiry
 * badges: rego and insurance unless another window is asked for (licences).
 */
export async function loadExpiryContext(
  user: SignedInUser,
  window: WarningDaysSetting = "vehicleExpiryWarningDays",
): Promise<ExpiryContext> {
  const settings = await loadOperatorSettings(appDb, user.operatorId);
  return {
    today: todayInTimeZone(new Date(), user.operatorTimezone),
    warningDays: settings[window],
  };
}
