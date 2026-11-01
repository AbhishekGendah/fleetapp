import { isRecordId } from "@fleetapp/core";
import { notFound, redirect } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import { openIssuedDocument } from "../../../../lib/contracts/issued-documents";
import { loadSigningStatus } from "../../../../lib/contracts/signing-links";
import { requireUser } from "../../../../lib/require-user";
import { appFileStorage } from "../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOWNLOAD_NAME = "Signed contract.pdf";

/** The rental's latest signed contract, through a short-lived address to the stored PDF. */
export async function GET(
  _request: Request,
  props: { params: Promise<{ rentalId: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { rentalId } = await props.params;
  if (!isRecordId(rentalId)) {
    notFound();
  }
  const { signed } = await loadSigningStatus(appDb, user.operatorId, rentalId, new Date());
  const url = signed
    ? await openIssuedDocument(
        { database: appDb, storage: appFileStorage },
        user.operatorId,
        signed.documentId,
        DOWNLOAD_NAME,
      )
    : null;
  if (!url) {
    notFound();
  }
  redirect(url);
}
