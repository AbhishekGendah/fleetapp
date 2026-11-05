import { GST_START_DATE, todayInTimeZone, operatorDisplayName } from "@fleetapp/core";
import type { EmailSender } from "@fleetapp/email";

import { loadPdfBranding } from "../contracts/contract-pdf";
import type { FileDependencies } from "../files/stored-files";
import { loadBusinessDetails, type BusinessDetails } from "../settings/business-details";
import { loadOperatorSettings } from "../settings/operator-settings";
import type { BillingPdfParties } from "./billing-pdf";

/** What issuing needs: the database, file storage, the clock and email. */
export interface BillingDependencies extends FileDependencies {
  emailSender: EmailSender;
}

/** The business-wide facts every document of one business is made with. */
export interface BillingContext {
  business: BusinessDetails;
  branding: BillingPdfParties["branding"];
  /** The day the documents are issued, on the business's calendar. */
  today: string;
  /** Null when not GST-registered. */
  gstRegisteredFrom: string | null;
  howToPay: string;
  isEmailedAutomatically: boolean;
  /** The name a Renter's email comes from. */
  operatorName: string;
}

/** Loaded once per run, before any document is issued, so nothing is read twice inside a lock. */
export async function loadBillingContext(
  deps: BillingDependencies,
  operatorId: string,
): Promise<BillingContext> {
  const [business, branding, settings] = await Promise.all([
    loadBusinessDetails(deps.database, operatorId),
    loadPdfBranding(deps, operatorId),
    loadOperatorSettings(deps.database, operatorId),
  ]);
  if (!business) {
    throw new Error("The business could not be found in its own tenant context.");
  }
  return {
    business,
    branding,
    today: todayInTimeZone(deps.now(), business.timezone),
    // Registered with no date given: registered from the start of GST.
    gstRegisteredFrom: business.gstRegistered
      ? (business.gstRegisteredFrom ?? GST_START_DATE)
      : null,
    howToPay: settings.howToPay,
    isEmailedAutomatically: settings.isInvoiceEmailedAutomatically,
    operatorName: operatorDisplayName(business),
  };
}
