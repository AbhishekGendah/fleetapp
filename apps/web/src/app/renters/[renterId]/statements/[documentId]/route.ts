import { isRecordId } from "@fleetapp/core";
import { notFound, redirect } from "next/navigation";

import { appDb } from "../../../../../lib/app-db";
import { isRenterStatement } from "../../../../../lib/billing/business-statements";
import { openIssuedDocument } from "../../../../../lib/contracts/issued-documents";
import { requireUser } from "../../../../../lib/require-user";
import { appFileStorage } from "../../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOWNLOAD_NAME = "Statement.pdf";

/**
 * One of a business Renter's statements across its cars, through a
 * short-lived address to the stored PDF: only the signed-in User's own
 * Operator's, and only that Renter's (rule 1).
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ renterId: string; documentId: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { renterId, documentId } = await props.params;
  if (!isRecordId(renterId) || !isRecordId(documentId)) {
    notFound();
  }
  const target = { renterId, issuedDocumentId: documentId };
  const url = (await isRenterStatement(appDb, user.operatorId, target))
    ? await openIssuedDocument(
        { database: appDb, storage: appFileStorage },
        user.operatorId,
        documentId,
        DOWNLOAD_NAME,
      )
    : null;
  if (!url) {
    notFound();
  }
  redirect(url);
}
