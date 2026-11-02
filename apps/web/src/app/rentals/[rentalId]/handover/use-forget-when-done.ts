"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { forgetHandover } from "../../../../lib/handover/offline/handover-store";
import { rentalPath } from "../../../../lib/paths";

/**
 * Once a checklist is finished (or a swap's two), wipes it from the phone (what was typed,
 * waiting photos, the saved page) and goes back to the rental.
 */
export function useForgetWhenDone(
  isDone: boolean,
  checklist: { inspectionId: string; rentalId: string; otherInspectionId?: string },
): void {
  const router = useRouter();
  const { inspectionId, rentalId, otherInspectionId } = checklist;
  useEffect(() => {
    if (isDone) {
      const forgotten = [inspectionId, ...(otherInspectionId ? [otherInspectionId] : [])].map(
        forgetHandover,
      );
      void Promise.all(forgotten).then(() => router.push(rentalPath(rentalId)));
    }
  }, [isDone, inspectionId, otherInspectionId, rentalId, router]);
}
