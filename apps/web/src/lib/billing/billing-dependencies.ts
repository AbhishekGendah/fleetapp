import { appEmailSender } from "../email-sender";
import { fileDependencies } from "../files/file-action-support";
import { appPayments } from "../payments/app-payments-provider";
import type { BillingDependencies } from "./billing-context";

/** The app's own database, file storage, clock, email and Stripe, for issuing from a screen. */
export function billingDependencies(): BillingDependencies {
  return { ...fileDependencies(), emailSender: appEmailSender, payments: appPayments };
}
