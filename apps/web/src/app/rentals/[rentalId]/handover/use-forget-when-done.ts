"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { errorName, WIPE_FAILED_LOG } from "../../../../lib/handover/offline/phone-wipe-log";
import { forgetChecklistPages } from "../../../../lib/handover/offline/checklist-pages";
import { forgetHandovers } from "../../../../lib/handover/offline/handover-store";
import { rentalPath } from "../../../../lib/paths";

/**
 * Once a checklist is finished (or a swap's two), wipes it from the phone (what was typed,
 * waiting photos, the saved page) and goes back to the rental. Only this rental's checklist:
 * others under way on the phone are kept (review A6-4).
 */
export function useForgetWhenDone(
  isDone: boolean,
  checklist: { inspectionId: string; rentalId: string; otherInspectionId?: string },
): void {
  const router = useRouter();
  const { inspectionId, rentalId, otherInspectionId } = checklist;
  useEffect(() => {
    if (isDone) {
      const inspectionIds = [inspectionId, ...(otherInspectionId ? [otherInspectionId] : [])];
      void Promise.all([forgetHandovers(inspectionIds), forgetChecklistPages(rentalId)])
        .catch((error: unknown) => console.error(WIPE_FAILED_LOG, errorName(error)))
        .finally(() => router.push(rentalPath(rentalId)));
    }
  }, [isDone, inspectionId, otherInspectionId, rentalId, router]);
}
