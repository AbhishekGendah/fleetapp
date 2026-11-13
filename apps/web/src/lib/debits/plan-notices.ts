import {
  instalmentShares,
  isNoticeLapsed,
  ledgerBalanceCents,
  scheduledDebitCents,
  type ChargeNoticeTerms,
  type DebitCollectionPlan,
} from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { debitNotices, debitPlans, ledgerLines } from "@fleetapp/db/schema";
import { and, eq } from "drizzle-orm";

import { pendingDebitCents } from "./debit-queries";

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

/** What a planned charge's next part would take: the whole charge, or a split's next share. */
export function nextPartCents(
  plan: { plan: DebitCollectionPlan; weeks: number | null; partsDebited: number },
  amountCents: number,
): number {
  if (plan.plan !== "split") {
    return plan.partsDebited === 0 ? amountCents : 0;
  }
  return instalmentShares(amountCents, plan.weeks ?? 0)[plan.partsDebited] ?? 0;
}

/**
 * Whether a part of this many cents would take nothing on the rental now:
 * what is owing, less its debits on their way, leaves nothing (or under 50c)
 * for it, as the debit run would cap it. Such a charge is covered (paid
 * another way): no debit, so no notice is emailed for it.
 */
export async function coveredOnRental(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<(partCents: number) => boolean> {
  const lines = await tx
    .select({
      id: ledgerLines.id,
      kind: ledgerLines.kind,
      amountCents: ledgerLines.amountCents,
      reversesId: ledgerLines.reversesId,
    })
    .from(ledgerLines)
    .where(and(eq(ledgerLines.operatorId, operatorId), eq(ledgerLines.rentalId, rentalId)));
  const owingCents = ledgerBalanceCents(lines);
  const pendingCents = await pendingDebitCents(tx, operatorId, rentalId);
  return (partCents) =>
    scheduledDebitCents({ plannedCents: partCents, owingCents, pendingCents }) === 0;
}
