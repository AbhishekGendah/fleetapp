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
    // Added 6 Nov 2026 with the dashboard's full Needs attention list.
    "/attention",
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
    // Batch 7 (review A10-9): the rest of Settings, the timeline, the
    // privacy notice and the new insurance form.
    "/settings/charges",
    "/settings/invoices",
    "/settings/payments",
    "/settings/demo-data",
    "/rentals/timeline",
    "/privacy-notice",
    "/cars/insurance/new",
    // Not "/suspended": the test login's business is not paused, so it would
    // only land on the dashboard. On docs/launch-checklist.md until it has one.
  ],
  signedOutPages: [
    "/sign-in",
    "/forgot-password",
    // Both ways the reset page shows: a link cut short, and the form itself.
    "/reset-password",
    "/reset-password?token=e2e-made-up-token",
  ],
  phoneViewport: PHONE_VIEWPORT,
});
