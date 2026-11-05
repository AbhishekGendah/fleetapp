import { describePageChecks } from "@fleetapp/e2e/accessibility";

import { PHONE_VIEWPORT } from "./e2e-settings";

/** Every admin page the browser tests reach, checked by axe-core against WCAG 2.2 AA. */
describePageChecks({
  signedInPages: [
    "/",
    "/components",
    "/operators",
    "/operators/new",
    "/car-models",
    // Batch 7 (review A9-6): the car models list of cars typed by Operators, and the test inbox.
    "/car-models/typed-by-operators",
    "/dev-outbox",
  ],
  signedOutPages: ["/sign-in"],
  phoneViewport: PHONE_VIEWPORT,
});
