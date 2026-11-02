import { isRecordId, type InspectionKind } from "@fleetapp/core";
import { notFound, redirect } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import {
  loadHandover,
  loadRentalHandoverStatus,
  loadReturn,
  type HandoverView,
} from "../../../../lib/handover/handover-queries";
import { rentalPath } from "../../../../lib/paths";
import { requireUser, type SignedInUser } from "../../../../lib/require-user";

/** The rental's checklist of this kind under way; back to the rental if there is none. */
export async function loadChecklistPage(
  params: Promise<{ rentalId: string }>,
  kind: InspectionKind,
): Promise<{ user: SignedInUser; rentalId: string; view: HandoverView }> {
  const user = await requireUser();
  const { rentalId } = await params;
  if (!isRecordId(rentalId)) {
    notFound();
  }
  const status = await loadRentalHandoverStatus(appDb, user.operatorId, rentalId, kind);
  const load = kind === "handover" ? loadHandover : loadReturn;
  const view = status.inProgressId ? await load(appDb, user.operatorId, status.inProgressId) : null;
  if (!view) {
    redirect(rentalPath(rentalId));
  }
  return { user, rentalId, view };
}
