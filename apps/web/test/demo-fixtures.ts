import { todayInTimeZone } from "@fleetapp/core";
import { loadVehicleCatalogue } from "@fleetapp/db/vehicle-catalogue";
import type { TestConnection } from "@fleetapp/db/testing";

import type { ActingUser } from "../src/lib/acting-user";
import type { DemoContext } from "../src/lib/demo-data/demo-context";
import { DEMO_STEPS, runDemoStep } from "../src/lib/demo-data/demo-steps";
import { TEST_TIME_ZONE } from "./rental-fixtures";
import { linkTestKit } from "./renter-link-fixtures";

/** A whole demo run makes hundreds of records, PDFs and photos. */
export const WHOLE_DEMO_RUN_MS = 300_000;

/** The demo tool's view of a test Operator, with stand-in storage and a recording inbox. */
export async function demoTestContext(
  web: TestConnection,
  actor: ActingUser,
): Promise<DemoContext> {
  const kit = linkTestKit(web, actor);
  return {
    deps: { ...kit.fileDeps, emailSender: kit.linkDeps.emailSender },
    actor,
    timeZone: TEST_TIME_ZONE,
    today: todayInTimeZone(new Date(), TEST_TIME_ZONE),
    catalogue: await loadVehicleCatalogue(web.db),
    links: kit.linkDeps,
  };
}

/** Runs every demo step in order; how many records were added. */
export async function runEveryDemoStep(context: DemoContext): Promise<number> {
  let added = 0;
  for (const step of DEMO_STEPS) {
    added += await runDemoStep(context, step.key);
  }
  return added;
}
