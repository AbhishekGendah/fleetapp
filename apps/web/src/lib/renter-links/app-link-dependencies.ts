import { formatDayInTimeZone, formatLinkExpiryInTimeZone } from "@fleetapp/core";

import { env } from "../../env";
import { appDb } from "../app-db";
import { appEmailSender } from "../email-sender";
import type { LinkDependencies } from "./details-links";

/** What sending a Renter link needs in the running app, with days told in the Operator's timezone. */
export function appLinkDependencies(timeZone: string): LinkDependencies {
  return {
    database: appDb,
    emailSender: appEmailSender,
    now: () => new Date(),
    appUrl: env.APP_URL,
    describeDay: (moment) => formatDayInTimeZone(moment, timeZone),
    describeMoment: (moment) => formatLinkExpiryInTimeZone(moment, timeZone),
  };
}
