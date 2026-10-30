import { isRecordId } from "@fleetapp/core";
import { notFound, redirect } from "next/navigation";

import { fileDependencies } from "../../../../../lib/files/file-action-support";
import { openLicenceScan } from "../../../../../lib/renters/licence-scans";
import { requireUser } from "../../../../../lib/require-user";

export const runtime = "nodejs";

/**
 * Opens a licence scan: checks the signed-in User's Operator owns it, logs
 * who looked (rule 8), then sends them to a link that works for 5 minutes.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ renterId: string; fileId: string }> },
): Promise<never> {
  const user = await requireUser();
  const { renterId, fileId } = await props.params;
  if (!isRecordId(renterId) || !isRecordId(fileId)) {
    notFound();
  }
  const url = await openLicenceScan(
    fileDependencies(),
    { userId: user.id, operatorId: user.operatorId },
    renterId,
    fileId,
  );
  if (!url) {
    notFound();
  }
  redirect(url);
}
