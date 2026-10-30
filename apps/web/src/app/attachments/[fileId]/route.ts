import { isRecordId } from "@fleetapp/core";
import { notFound, redirect } from "next/navigation";

import { openAttachment } from "../../../lib/files/attachments";
import { fileDependencies } from "../../../lib/files/file-action-support";
import { requireUser } from "../../../lib/require-user";

export const runtime = "nodejs";

/**
 * Opens an attachment: checks the signed-in User's Operator owns it, logs
 * the opening of purchase or sale papers (rule 8), then sends them to a link
 * that works for 5 minutes.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ fileId: string }> },
): Promise<never> {
  const user = await requireUser();
  const { fileId } = await props.params;
  if (!isRecordId(fileId)) {
    notFound();
  }
  const url = await openAttachment(
    fileDependencies(),
    { userId: user.id, operatorId: user.operatorId },
    fileId,
  );
  if (!url) {
    notFound();
  }
  redirect(url);
}
