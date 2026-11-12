import { describeErrorForLog, formatCents } from "@fleetapp/core";
import { renderBillingDocumentEmail } from "@fleetapp/email";

import { balanceText } from "../ledger/balance-text";
import { greetingNameOf } from "./billed-to";
import type { BillingContext, BillingDependencies } from "./billing-context";
import type { BillingRental, IssuedBilling } from "./billing-documents";

/** The line the Renter most needs in the email. A receipt's balance is left out when not known. */
export function amountLineOf(issued: {
  kind: IssuedBilling["kind"];
  totalCents: number;
  gstCents: number;
  balanceAfterCents: number | null;
}): string {
  if (issued.kind === "receipt") {
    const balance =
      issued.balanceAfterCents === null
        ? ""
        : ` Balance: ${balanceText(issued.balanceAfterCents).toLowerCase()}.`;
    return `Received ${formatCents(issued.totalCents)}.${balance}`;
  }
  const gst = issued.gstCents > 0 ? `, including GST of ${formatCents(issued.gstCents)}` : "";
  return issued.kind === "credit_note"
    ? `Credit ${formatCents(issued.totalCents)}${gst}.`
    : `Total ${formatCents(issued.totalCents)}${gst}.`;
}

/** Emails a document to the Renter (a business's contact) from the business. It is kept either way, so a failure is logged, never raised. */
export async function emailBillingDocument(
  deps: BillingDependencies,
  context: Pick<BillingContext, "business" | "operatorName">,
  rental: Pick<BillingRental, "renterEmail" | "billedTo" | "rentalSummary">,
  document: {
    title: string;
    numberText: string | null;
    amountLine: string;
    pdf: Uint8Array;
    /** One-off charges, worded for the Renter (docs/plans/one-off-charge-notice.md). */
    chargeLines?: readonly string[] | undefined;
    contactLine?: string | undefined;
  },
): Promise<boolean> {
  if (!rental.renterEmail) {
    return false;
  }
  try {
    await deps.emailSender.send(
      await renderBillingDocumentEmail({
        to: rental.renterEmail,
        replyTo: context.business.email ?? undefined,
        title: document.title,
        numberText: document.numberText,
        renterName: greetingNameOf(rental.billedTo),
        businessName: rental.billedTo.kind === "organisation" ? rental.billedTo.name : undefined,
        operatorName: context.operatorName,
        rentalSummary: rental.rentalSummary,
        amountLine: document.amountLine,
        chargeLines: document.chargeLines,
        contactLine: document.contactLine,
        attachment: {
          fileName: `${document.numberText ?? document.title}.pdf`,
          contentType: "application/pdf",
          content: document.pdf,
        },
      }),
    );
    return true;
  } catch (error) {
    console.error(`Emailing a ${document.title.toLowerCase()} failed`, describeErrorForLog(error));
    return false;
  }
}
