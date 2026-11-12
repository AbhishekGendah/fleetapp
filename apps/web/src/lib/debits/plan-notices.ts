import { isNoticeLapsed, type ChargeNoticeTerms } from "@fleetapp/core";
import { debitNotices, debitPlans } from "@fleetapp/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * A one-off charge's plan's current notice (docs/plans/one-off-charge-notice.md):
 * join with NOTICE_OF_PLAN, select PLAN_NOTICE_COLUMNS. The database voids a
 * plan's notice on any change of its terms, so the one it points at states
 * them exactly.
 */
export const NOTICE_OF_PLAN = and(
  eq(debitNotices.id, debitPlans.noticeId),
  eq(debitNotices.operatorId, debitPlans.operatorId),
);

export const PLAN_NOTICE_COLUMNS = {
  noticeId: debitNotices.id,
  noticeDate: debitNotices.noticeDate,
  partsBefore: debitNotices.partsBefore,
};

/** A plan's notice as selected with PLAN_NOTICE_COLUMNS (all null when it has none). */
export interface SelectedNotice {
  noticeId: string | null;
  noticeDate: string | null;
  partsBefore: number | null;
}

/**
 * The notice that still covers the plan's next part on `today` (the
 * business's day): none when it has none, or it has lapsed (its part's
 * window passed with nothing debited), so a new email is needed.
 */
export function currentNoticeOf(
  selected: SelectedNotice,
  partsDebited: number,
  today: string,
): (ChargeNoticeTerms & { id: string }) | null {
  if (!selected.noticeId || !selected.noticeDate || selected.partsBefore === null) {
    return null;
  }
  const notice = {
    id: selected.noticeId,
    noticeDate: selected.noticeDate,
    partsBefore: selected.partsBefore,
  };
  return isNoticeLapsed(notice, partsDebited + 1, today) ? null : notice;
}
