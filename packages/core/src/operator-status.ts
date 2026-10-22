import { getInviteStatus, type InviteDates } from "./invites";

export const OPERATOR_STATUSES = [
  "suspended",
  "active",
  "invited",
  "invite_not_sent",
  "invite_expired",
  "no_invite",
] as const;
export type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

export interface OperatorStatusInput {
  suspendedAt: Date | null;
  /** The Operator's most recent invite, or null if it has never had one. */
  latestInvite: InviteDates | null;
}

/**
 * The one status an Admin sees in the Operator list.
 *
 * Suspension wins over everything: it is what an Admin most needs to see.
 * "Active" means the User has accepted their invite; until slice 4 that
 * cannot happen yet.
 */
export function getOperatorStatus(input: OperatorStatusInput, now: Date): OperatorStatus {
  if (input.suspendedAt) {
    return "suspended";
  }
  if (!input.latestInvite) {
    return "no_invite";
  }

  switch (getInviteStatus(input.latestInvite, now)) {
    case "accepted":
      return "active";
    case "pending":
      return "invited";
    case "not_sent":
      return "invite_not_sent";
    case "expired":
      return "invite_expired";
    case "revoked":
      // Resend revokes the old invite and issues a new one in the same step,
      // so a revoked latest invite means none is outstanding.
      return "no_invite";
  }
}
