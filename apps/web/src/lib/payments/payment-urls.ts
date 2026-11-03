import { env } from "../../env";
import { PAYMENT_SETTINGS_PATH, STRIPE_ONBOARDING_PATH } from "../paths";
import type { OnboardingUrls } from "./payments-provider";

/** Where Stripe's onboarding sends the business back to, on this site (APP_URL, never typed in). */
export function onboardingUrls(): OnboardingUrls {
  return {
    returnUrl: new URL(PAYMENT_SETTINGS_PATH, env.APP_URL).toString(),
    refreshUrl: new URL(STRIPE_ONBOARDING_PATH, env.APP_URL).toString(),
  };
}
