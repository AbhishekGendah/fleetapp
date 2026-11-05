import {
  describeErrorForLog,
  documentEmailState,
  type DocumentEmailOutcome,
  type DocumentEmailRecipient,
  type DocumentEmailState,
  operatorDisplayName,
} from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { documentEmails } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import {
  renderDocumentCopyEmail,
  type CopiedDocumentKind,
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
  /** Just one of the two, when only that copy is sent again. */
  onlyTo?: DocumentEmailRecipient;
}

type Recipient = { recipient: DocumentEmailRecipient; to: string | null };

/** One copy sent, or why it wasn't. Never throws: the document is kept either way. */
async function sendCopy(
  deps: { emailSender: EmailSender },
  copy: Recipient,
  render: (
    to: string,
    audience: "renter" | "operator",
  ) => ReturnType<typeof renderDocumentCopyEmail>,
  kind: CopiedDocumentKind,
): Promise<DocumentEmailOutcome> {
  if (!copy.to) {
    return "no_address";
  }
  try {
    await deps.emailSender.send(
      await render(copy.to, copy.recipient === "renter" ? "renter" : "operator"),
    );
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
 * Emails a fixed document's copies: the Renter's from the business (replies
 * go to it), and the business's to its own email, and records how each went.
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
  const recipients: Recipient[] = [
    { recipient: "renter" as const, to: copies.renterEmail },
    { recipient: "business" as const, to: business?.email ?? null },
  ].filter((copy) => !copies.onlyTo || copy.recipient === copies.onlyTo);
  const render = (to: string, audience: "renter" | "operator") =>
    renderDocumentCopyEmail({
      kind: copies.kind,
      renterName: copies.renterName,
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
