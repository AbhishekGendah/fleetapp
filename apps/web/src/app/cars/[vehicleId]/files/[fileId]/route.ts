import { isRecordId } from "@fleetapp/core";
import { notFound, redirect } from "next/navigation";

import { appDb } from "../../../../../lib/app-db";
import { findCarFileViewUrl } from "../../../../../lib/files/car-files";
import { requireUser } from "../../../../../lib/require-user";
import { appFileStorage } from "../../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";

/**
 * Opens one of a car's photos or documents: checks the signed-in User's
 * Operator owns it, then sends them to a link that works for 5 minutes. The
 * page links here rather than to storage, so its links never go stale.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ vehicleId: string; fileId: string }> },
): Promise<never> {
  const user = await requireUser();
  const { vehicleId, fileId } = await props.params;
  if (!isRecordId(vehicleId) || !isRecordId(fileId)) {
    notFound();
  }
  const url = await findCarFileViewUrl(
    { database: appDb, storage: appFileStorage },
    user.operatorId,
    vehicleId,
    fileId,
  );
  if (!url) {
    notFound();
  }
  redirect(url);
}
