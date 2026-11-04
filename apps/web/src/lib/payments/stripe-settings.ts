/** Stripe's secret keys say which mode they are for: live money, or its sandbox. */
const STRIPE_LIVE_KEY = /^(sk|rk)_live_/;
const STRIPE_TEST_KEY = /^(sk|rk)_test_/;

export interface StripeSettings {
  PAYMENTS_TRANSPORT: string;
  STRIPE_SECRET_KEY?: string | undefined;
  STRIPE_WEBHOOK_SECRET?: string | undefined;
  APP_STAGE?: string | undefined;
}

/**
 * What is wrong with the payments settings, if anything. Stripe needs both
 * its secrets; the stand-in needs the events secret to sign with. The live
 * site must take live money only (review A5-9): a test key there would let a
 * fake test card "pay" a bond. So production refuses a test key and the
 * stand-in, a live key is refused anywhere not marked production (so
 * leaving the production setting out can't go unnoticed), and the stand-in
 * runs only where development is said outright (decision 6).
 */
export function stripeSettingsProblems(
  env: StripeSettings,
): { path: keyof StripeSettings; message: string }[] {
  const key = env.STRIPE_SECRET_KEY ?? "";
  const isProduction = env.APP_STAGE === "production";
  const checks: [boolean, keyof StripeSettings, string][] = [
    [
      env.PAYMENTS_TRANSPORT === "stripe" && !key,
      "STRIPE_SECRET_KEY",
      "PAYMENTS_TRANSPORT=stripe needs STRIPE_SECRET_KEY.",
    ],
    [
      env.PAYMENTS_TRANSPORT !== "off" && !env.STRIPE_WEBHOOK_SECRET,
      "STRIPE_WEBHOOK_SECRET",
      "Taking Stripe's events needs STRIPE_WEBHOOK_SECRET.",
    ],
    [
      env.PAYMENTS_TRANSPORT === "stand_in" && env.APP_STAGE !== "development",
      "PAYMENTS_TRANSPORT",
      "PAYMENTS_TRANSPORT=stand_in is for development only: set APP_STAGE=development.",
    ],
    [
      isProduction && env.PAYMENTS_TRANSPORT === "stripe" && STRIPE_TEST_KEY.test(key),
      "STRIPE_SECRET_KEY",
      "Production must use Stripe's live key, never a test key.",
    ],
    [
      !isProduction && STRIPE_LIVE_KEY.test(key),
      "APP_STAGE",
      "A live Stripe key is set, so this is the live site: set APP_STAGE=production.",
    ],
  ];
  return checks.filter(([isProblem]) => isProblem).map(([, path, message]) => ({ path, message }));
}
