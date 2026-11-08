import {
  describeErrorForLog,
  documentEmailState,
  type DocumentEmailOutcome,
  type DocumentEmailRecipient,
  type DocumentEmailState,
  type BusinessAcceptance,
  operatorDisplayName,
} from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { documentEmails } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import {
  renderDocumentCopyEmail,
  type CopiedDocumentKind,
  type DocumentCopyAudience,
  type EmailSender,
} from "@fleetapp/email";

import { loadBusinessDetails } from "../settings/business-details";

export interface DocumentCopies {
  /** The issued document the copies are of: each try is recorded against it. */
  documentId: string;
  kind: CopiedDocumentKind;
  operatorId: string;
  /** None when the Renter has no email on file: the business still gets its copy. */
  renterEmail: string | null;
  renterName: string;
  rentalSummary: string;
  /** When it was signed or accepted, on the business's clock. */
  atText: string;
  fileName: string;
  pdf: Uint8Array;
  /** Who pressed "Email again"; none for the copies sent when it was issued. */
  sentByUserId?: string | null;
  /** Just these copies, when only they are sent again. */
  onlyTo?: readonly DocumentEmailRecipient[];
  /** A business's car: the driver who signed, and the business they have it for (rule 15). */
  forBusiness?: BusinessAcceptance;
  /**
   * The driver who signed a business's car's papers gets their own copy, to
   * their own email only (none on file: recorded as no address). Never for a
   * person's own rental (the Renter is the driver) or a contract.
   */
  driverCopy?: { email: string | null };
}

/**
 * A business's signed contract or change of terms: the copy greets the
 * person who signed for it, and every copy names the business they signed
 * for. The same words when it is signed and when it is emailed again.
 */
export function businessSignerCopy(
  signerName: string,
  businessName: string,
): Required<Pick<DocumentCopies, "renterName" | "forBusiness">> {
  return { renterName: signerName, forBusiness: { driverName: signerName, businessName } };
}

type Recipient = { recipient: DocumentEmailRecipient; to: string | null };

const AUDIENCE_OF: Readonly<Record<DocumentEmailRecipient, DocumentCopyAudience>> = {
  renter: "renter",
  driver: "driver",
  business: "operator",
};

/** Whose copies these papers have: the Renter, a business's driver who signed, and the business. */
function recipientsOf(copies: DocumentCopies, businessEmail: string | null): Recipient[] {
  const driver: Recipient[] =
    copies.forBusiness && copies.driverCopy
      ? [{ recipient: "driver", to: copies.driverCopy.email }]
      : [];
  const all: Recipient[] = [
    { recipient: "renter", to: copies.renterEmail },
    ...driver,
    { recipient: "business", to: businessEmail },
  ];
  return copies.onlyTo ? all.filter((copy) => copies.onlyTo?.includes(copy.recipient)) : all;
}

/** One copy sent, or why it wasn't. Never throws: the document is kept either way. */
async function sendCopy(
  deps: { emailSender: EmailSender },
  copy: Recipient,
  render: (
    to: string,
    audience: DocumentCopyAudience,
  ) => ReturnType<typeof renderDocumentCopyEmail>,
  kind: CopiedDocumentKind,
): Promise<DocumentEmailOutcome> {
  if (!copy.to) {
    return "no_address";
  }
  try {
    await deps.emailSender.send(await render(copy.to, AUDIENCE_OF[copy.recipient]));
    return "sent";
  } catch (error) {
    // Never the error itself: a provider's message can quote the address.
    console.error(`Emailing a copy (${kind}) failed`, describeErrorForLog(error));
    return "failed";
  }
}

/** Keeps each try, so the rental page says what really happened (review G7-1, G9-9). */
async function recordTries(
  database: AnyDatabase,
  copies: DocumentCopies,
  tries: { recipient: DocumentEmailRecipient; outcome: DocumentEmailOutcome }[],
): Promise<void> {
  try {
    await withTenant(database, copies.operatorId, (tx) =>
      tx.insert(documentEmails).values(
        tries.map((attempt) => ({
          operatorId: copies.operatorId,
          documentId: copies.documentId,
          recipient: attempt.recipient,
          outcome: attempt.outcome,
          sentByUserId: copies.sentByUserId ?? null,
        })),
      ),
    );
  } catch (error) {
    console.error("Recording an emailed copy failed", describeErrorForLog(error));
  }
}

/**
 * Emails a fixed document's copies: the Renter's and a business's driver's
 * from the business (replies go to it), each to their own email only, and
 * the business's to its own email, and records how each went.
 * Never throws: it runs after the document is kept for good, so nothing here
 * may make a screen say that nothing was saved (review G9-9).
 */
export async function emailDocumentCopies(
  deps: { database: AnyDatabase; emailSender: EmailSender },
  copies: DocumentCopies,
): Promise<DocumentEmailState> {
  const business = await loadBusinessDetails(deps.database, copies.operatorId).catch(
    (error: unknown) => {
      console.error("Loading the business for an emailed copy failed", describeErrorForLog(error));
      return undefined;
    },
  );
  const recipients = recipientsOf(copies, business?.email ?? null);
  const render = (to: string, audience: DocumentCopyAudience) =>
    renderDocumentCopyEmail({
      kind: copies.kind,
      renterName: copies.renterName,
      forBusiness: copies.forBusiness,
      operatorName: operatorDisplayName(business),
      rentalSummary: copies.rentalSummary,
      at: copies.atText,
      attachment: {
        fileName: copies.fileName,
        contentType: "application/pdf",
        content: copies.pdf,
      },
      to,
      audience,
      replyTo: business?.email ?? undefined,
    });
  const tries = [];
  for (const copy of recipients) {
    // A business whose details couldn't be read is a failed send, not a missing address.
    const outcome =
      copy.recipient === "business" && business === undefined
        ? "failed"
        : await sendCopy(deps, copy, render, copies.kind);
    tries.push({ recipient: copy.recipient, outcome });
  }
  await recordTries(deps.database, copies, tries);
  return documentEmailState(tries);
}
