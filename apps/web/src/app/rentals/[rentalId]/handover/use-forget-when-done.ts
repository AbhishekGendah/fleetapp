"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { forgetHandover } from "../../../../lib/handover/offline/handover-store";
import { rentalPath } from "../../../../lib/paths";

/**
 * Once a checklist is finished, wipes it from the phone (what was typed,
 * waiting photos, the saved page) and goes back to the rental.
 */
export function useForgetWhenDone(
  isDone: boolean,
  checklist: { inspectionId: string; rentalId: string },
): void {
  const router = useRouter();
  const { inspectionId, rentalId } = checklist;
  useEffect(() => {
    if (isDone) {
      void forgetHandover(inspectionId).then(() => router.push(rentalPath(rentalId)));
    }
  }, [isDone, inspectionId, rentalId, router]);
}
