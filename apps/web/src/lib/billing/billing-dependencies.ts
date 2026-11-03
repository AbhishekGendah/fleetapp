import { appEmailSender } from "../email-sender";
import { fileDependencies } from "../files/file-action-support";
import type { BillingDependencies } from "./billing-context";

/** The app's own database, file storage, clock and email, for issuing from a screen. */
export function billingDependencies(): BillingDependencies {
  return { ...fileDependencies(), emailSender: appEmailSender };
}
