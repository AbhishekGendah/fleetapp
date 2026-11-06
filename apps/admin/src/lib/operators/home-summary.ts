import { MILLISECONDS_PER_DAY, type OperatorStatus } from "@fleetapp/core";

import type { OperatorSummary } from "./queries";

/** How far back "signed in lately" looks on the admin home. */
export const RECENT_SIGN_IN_DAYS = 7;

/** The statuses counted on the admin home, in the order shown. */
export const HOME_STATUS_ORDER: readonly OperatorStatus[] = [
  "active",
  "invited",
  "invite_expired",
  "invite_not_sent",
  "no_invite",
  "suspended",
];

export interface SetupGap {
  operatorId: string;
  name: string;
  hasBusinessDetails: boolean;
  isStripeReady: boolean;
}

export interface AdminHomeSummary {
  total: number;
  countByStatus: ReadonlyMap<OperatorStatus, number>;
  /** Signed-up businesses still missing their details or Stripe. */
  setupGaps: SetupGap[];
  signedInLately: number;
  storageUsedBytes: number;
}

/** What the admin home shows, worked out from the Operator list (no Renter data, rule 5). */
export function summariseForAdminHome(
  operatorList: readonly OperatorSummary[],
  now: Date,
): AdminHomeSummary {
  const since = now.getTime() - RECENT_SIGN_IN_DAYS * MILLISECONDS_PER_DAY;
  const countByStatus = new Map<OperatorStatus, number>();
  for (const operator of operatorList) {
    countByStatus.set(operator.status, (countByStatus.get(operator.status) ?? 0) + 1);
  }
  return {
    total: operatorList.length,
    countByStatus,
    setupGaps: operatorList
      .filter(
        (operator) =>
          operator.status === "active" && (!operator.hasBusinessDetails || !operator.isStripeReady),
      )
      .map((operator) => ({
        operatorId: operator.id,
        name: operator.tradingName ?? operator.legalName,
        hasBusinessDetails: operator.hasBusinessDetails,
        isStripeReady: operator.isStripeReady,
      })),
    signedInLately: operatorList.filter(
      (operator) => operator.lastSignedInAt && operator.lastSignedInAt.getTime() >= since,
    ).length,
    storageUsedBytes: operatorList.reduce((sum, operator) => sum + operator.storageUsedBytes, 0),
  };
}
