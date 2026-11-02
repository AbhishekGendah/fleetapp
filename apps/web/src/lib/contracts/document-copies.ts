import { describeErrorForLog } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import {
  renderDocumentCopyEmail,
  type CopiedDocumentKind,
  type EmailSender,
} from "@fleetapp/email";

import { loadBusinessDetails } from "../settings/business-details";

export interface DocumentCopies {
  kind: CopiedDocumentKind;
  operatorId: string;
  operatorName: string;
  /** None when the Renter has no email on file: the business still gets its copy. */
  renterEmail: string | null;
  renterName: string;
  rentalSummary: string;
  /** When it was signed or accepted, on the business's clock. */
  atText: string;
  fileName: string;
  pdf: Uint8Array;
}

/**
 * Emails a fixed document's copies: the Renter's from the business (replies
 * go to it), and the business's to its own email. The document is kept
 * either way, so a failed email is logged, never raised.
 */
export async function emailDocumentCopies(
  deps: { database: AnyDatabase; emailSender: EmailSender },
  copies: DocumentCopies,
): Promise<void> {
  const business = await loadBusinessDetails(deps.database, copies.operatorId);
  const shared = {
    kind: copies.kind,
    renterName: copies.renterName,
    operatorName: copies.operatorName,
    rentalSummary: copies.rentalSummary,
    at: copies.atText,
    attachment: { fileName: copies.fileName, contentType: "application/pdf", content: copies.pdf },
  };
  const recipients = [
    ...(copies.renterEmail ? [{ to: copies.renterEmail, audience: "renter" as const }] : []),
    ...(business?.email ? [{ to: business.email, audience: "operator" as const }] : []),
  ];
  for (const recipient of recipients) {
    try {
      await deps.emailSender.send(
        await renderDocumentCopyEmail({
          ...shared,
          ...recipient,
          replyTo: business?.email ?? undefined,
        }),
      );
    } catch (error) {
      console.error(`Emailing a copy (${copies.kind}) failed`, describeErrorForLog(error));
    }
  }
}
