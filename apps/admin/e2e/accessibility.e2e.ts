import { describePageChecks } from "@fleetapp/e2e/accessibility";

import { PHONE_VIEWPORT } from "./e2e-settings";

/** Every admin page the browser tests reach, checked by axe-core against WCAG 2.2 AA. */
describePageChecks({
  signedInPages: ["/", "/components", "/operators", "/operators/new", "/car-models"],
  signedOutPages: ["/sign-in"],
  phoneViewport: PHONE_VIEWPORT,
});
