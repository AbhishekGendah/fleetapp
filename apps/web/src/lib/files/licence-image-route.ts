import { isRecordId } from "@fleetapp/core";
import { notFound, redirect } from "next/navigation";

import type { ActingUser } from "../acting-user";
import { requireUser } from "../require-user";
import { fileDependencies } from "./file-action-support";
import type { FileDependencies } from "./stored-files";

type LicenceImageOpener = (
  deps: FileDependencies,
  actor: ActingUser,
  renterId: string,
  fileId: string,
) => Promise<string | null>;

/**
 * What a route that opens a licence image does: checks the signed-in User's
 * Operator owns it, has `open` log who looked (rule 8), then sends them to a
 * link that works for 5 minutes. Anything else is "page not found".
 */
export async function redirectToLicenceImage(
  params: Promise<{ renterId: string; fileId: string }>,
  open: LicenceImageOpener,
): Promise<never> {
  const user = await requireUser();
  const { renterId, fileId } = await params;
  if (!isRecordId(renterId) || !isRecordId(fileId)) {
    notFound();
  }
  const url = await open(
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
