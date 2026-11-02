import "server-only";

import { loadVehicleCatalogue } from "@fleetapp/db/vehicle-catalogue";
import { todayInTimeZone } from "@fleetapp/core";

import { env } from "../../env";
import { appDb } from "../app-db";
import { appEmailSender } from "../email-sender";
import { appLinkDependencies } from "../renter-links/app-link-dependencies";
import type { SignedInUser } from "../require-user";
import { appFileStorage } from "../storage/app-file-storage";
import type { DemoContext } from "./demo-context";
import { isDemoDataAllowedFor } from "./demo-gate";

/** Whether this site may fill a business with demo data: never on the live site. */
export function isDemoDataAllowed(): boolean {
  return isDemoDataAllowedFor(env);
}

/** The signed-in User's own business, with the app's real storage and the test inbox. */
export async function demoContextFor(user: SignedInUser): Promise<DemoContext> {
  return {
    deps: {
      database: appDb,
      storage: appFileStorage,
      now: () => new Date(),
      emailSender: appEmailSender,
    },
    actor: { userId: user.id, operatorId: user.operatorId },
    timeZone: user.operatorTimezone,
    today: todayInTimeZone(new Date(), user.operatorTimezone),
    catalogue: await loadVehicleCatalogue(appDb),
    links: appLinkDependencies(user.operatorTimezone),
  };
}
