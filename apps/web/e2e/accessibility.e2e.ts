import { describePageChecks } from "@fleetapp/e2e/accessibility";

import { PHONE_VIEWPORT } from "./e2e-settings";

/**
 * Every Operator app page the browser tests reach without a record, checked
 * by axe-core against WCAG 2.2 AA. Record pages (a car, a Renter, a Renter's
 * link) are checked in their own tests.
 */
describePageChecks({
  signedInPages: [
    "/",
    "/cars",
    "/cars/new",
    "/cars/insurance",
    "/renters",
    "/renters/new",
    "/rentals",
    "/rentals/new",
    "/rentals/calendar",
    "/settings",
    "/settings/contracts",
  ],
  signedOutPages: ["/sign-in", "/forgot-password"],
  phoneViewport: PHONE_VIEWPORT,
});
