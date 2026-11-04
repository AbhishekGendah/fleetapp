import { describe, expect, it } from "vitest";

import { stripeSettingsProblems } from "../src/lib/payments/stripe-settings";

const LIVE = { PAYMENTS_TRANSPORT: "stripe", STRIPE_WEBHOOK_SECRET: "whsec_x" } as const;

/** The live site takes live money only (review A5-9). */
describe("the payments settings", () => {
  it("accept a live key on production and a test key elsewhere", () => {
    expect(
      stripeSettingsProblems({ ...LIVE, STRIPE_SECRET_KEY: "sk_live_1", APP_STAGE: "production" }),
    ).toEqual([]);
    expect(stripeSettingsProblems({ ...LIVE, STRIPE_SECRET_KEY: "sk_test_1" })).toEqual([]);
  });

  it("refuse a test key on production, and a live key anywhere not marked production", () => {
    const paths = (settings: Parameters<typeof stripeSettingsProblems>[0]) =>
      stripeSettingsProblems(settings).map((problem) => problem.path);
    expect(paths({ ...LIVE, STRIPE_SECRET_KEY: "sk_test_1", APP_STAGE: "production" })).toEqual([
      "STRIPE_SECRET_KEY",
    ]);
    expect(paths({ ...LIVE, STRIPE_SECRET_KEY: "rk_live_1" })).toEqual(["APP_STAGE"]);
  });

  it("run the stand-in only where development is said outright", () => {
    const standIn = { PAYMENTS_TRANSPORT: "stand_in", STRIPE_WEBHOOK_SECRET: "whsec_x" };
    expect(stripeSettingsProblems({ ...standIn, APP_STAGE: "development" })).toEqual([]);
    expect(stripeSettingsProblems(standIn)).toHaveLength(1);
    expect(stripeSettingsProblems({ ...standIn, APP_STAGE: "production" })).toHaveLength(1);
  });
});
