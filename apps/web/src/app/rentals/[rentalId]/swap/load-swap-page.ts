import { isRecordId } from "@fleetapp/core";
import { withTenant } from "@fleetapp/db/tenant-context";
import { notFound, redirect } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import {
  loadHandover,
  loadReturn,
  type HandoverView,
} from "../../../../lib/handover/handover-queries";
import { rentalPath } from "../../../../lib/paths";
import { swapUnderWay, type CarSwap } from "../../../../lib/rentals/car-swaps";
import { requireUser, type SignedInUser } from "../../../../lib/require-user";

/**
 * The swap under way and one of its checklists: the old car's return, or
 * the new car's handover. Back to the rental if there is no swap.
 */
export async function loadSwapPage(
  params: Promise<{ rentalId: string }>,
  car: "old" | "new",
): Promise<{ user: SignedInUser; rentalId: string; swap: CarSwap; view: HandoverView }> {
  const user = await requireUser();
  const { rentalId } = await params;
  if (!isRecordId(rentalId)) {
    notFound();
  }
  const swap = await withTenant(appDb, user.operatorId, (tx) =>
    swapUnderWay(tx, user.operatorId, rentalId),
  );
  const view = !swap
    ? null
    : car === "old"
      ? await loadReturn(appDb, user.operatorId, swap.returnInspectionId)
      : await loadHandover(appDb, user.operatorId, swap.handoverInspectionId);
  if (!swap || !view) {
    redirect(rentalPath(rentalId));
  }
  return { user, rentalId, swap, view };
}
