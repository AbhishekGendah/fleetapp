import { describe, expect, it } from "vitest";
import { z } from "zod";

import { refuseTestInboxInProduction } from "./env";

const settingsSchema = z
  .object({ EMAIL_TRANSPORT: z.string(), APP_STAGE: z.string().optional() })
  .superRefine(refuseTestInboxInProduction);

/** The test inbox runs only where development is said outright (review A9-7). */
describe("the test inbox", () => {
  it("runs with APP_STAGE=development", () => {
    expect(
      settingsSchema.safeParse({ EMAIL_TRANSPORT: "dev_outbox", APP_STAGE: "development" }).success,
    ).toBe(true);
  });

  it("refuses to start with the stage missing or production", () => {
    expect(settingsSchema.safeParse({ EMAIL_TRANSPORT: "dev_outbox" }).success).toBe(false);
    expect(
      settingsSchema.safeParse({ EMAIL_TRANSPORT: "dev_outbox", APP_STAGE: "production" }).success,
    ).toBe(false);
  });
});
