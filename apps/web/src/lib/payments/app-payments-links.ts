import "server-only";

import { appLinkDependencies } from "../renter-links/app-link-dependencies";
import { appPayments, canHearRenterPayments } from "./app-payments";
import type { PaymentsLinkDependencies } from "./payments-links";

/** What a Renter's payment steps and links need in the running app, days told in the Operator's timezone. */
export function appPaymentsLinkDependencies(timeZone: string): PaymentsLinkDependencies {
  return { ...appLinkDependencies(timeZone), payments: appPayments, canHearRenterPayments };
}
