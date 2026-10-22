import type { InviteStatus, OperatorStatus } from "@fleetapp/core";

export const OPERATOR_STATUS_LABELS: Record<OperatorStatus, string> = {
  suspended: "Suspended",
  active: "Active",
  invited: "Invited",
  invite_not_sent: "Invite not sent",
  invite_expired: "Invite expired",
  no_invite: "No invite",
};

export const INVITE_STATUS_LABELS: Record<InviteStatus, string> = {
  pending: "Waiting to be accepted",
  not_sent: "Not sent",
  expired: "Expired",
  revoked: "Cancelled",
  accepted: "Accepted",
};

/** The statuses an Admin needs to act on are the ones that stand out. */
const NEEDS_ATTENTION: ReadonlySet<OperatorStatus> = new Set([
  "suspended",
  "invite_not_sent",
  "invite_expired",
  "no_invite",
]);

export function operatorStatusNeedsAttention(status: OperatorStatus): boolean {
  return NEEDS_ATTENTION.has(status);
}
