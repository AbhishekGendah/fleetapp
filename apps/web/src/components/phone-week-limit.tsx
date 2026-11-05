"use client";

import { useEffect } from "react";

import { forgetWeekOldChecklists } from "../lib/handover/offline/phone-tidy-up";
import { errorName, WIPE_FAILED_LOG } from "../lib/handover/offline/phone-wipe-log";

/**
 * On every signed-in page: wipes checklists kept on this phone for over a
 * week, so a phone that never reopens a checklist still lets them go
 * (review A6-4).
 */
export function PhoneWeekLimit(): null {
  useEffect(() => {
    void forgetWeekOldChecklists().catch((error: unknown) =>
      console.error(WIPE_FAILED_LOG, errorName(error)),
    );
  }, []);
  return null;
}
