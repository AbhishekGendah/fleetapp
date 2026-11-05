"use client";

import { useEffect } from "react";

import { forgetEndedChecklists } from "../lib/handover/offline/phone-tidy-up";
import { errorName, WIPE_FAILED_LOG } from "../lib/handover/offline/phone-wipe-log";

/**
 * On a rental's page: wipes from this phone any of its checklists that have
 * ended, whether cancelled here or finished on another phone (review A6-4).
 * Safe to run again, so it simply runs whenever the page's details refresh.
 */
export function ForgetEndedChecklists(props: {
  rentalId: string;
  endedInspectionIds: string[];
  openPagePaths: string[];
}): null {
  const { rentalId, endedInspectionIds, openPagePaths } = props;
  useEffect(() => {
    void forgetEndedChecklists(rentalId, endedInspectionIds, openPagePaths).catch(
      (error: unknown) => console.error(WIPE_FAILED_LOG, errorName(error)),
    );
  }, [rentalId, endedInspectionIds, openPagePaths]);
  return null;
}
