import { joinUrl } from "./urls";

/** How long an invite link works for. An AGS setting, not an Operator one. */
export const INVITE_LIFETIME_DAYS = 7;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Where an invite link points, on the Operator app. Shared because the admin
 * app builds the link and the Operator app serves the page (slice 4).
 */
export const INVITE_ACCEPT_PATH = "/invite";

export function buildInviteUrl(appUrl: string, token: string): string {
  return joinUrl(appUrl, `${INVITE_ACCEPT_PATH}/${token}`);
}

export const INVITE_STATUSES = ["pending", "not_sent", "expired", "revoked", "accepted"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export interface InviteDates {
  expiresAt: Date;
  sentAt: Date | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export function getInviteExpiry(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + INVITE_LIFETIME_DAYS * MILLISECONDS_PER_DAY);
}

/**
 * Accepted and revoked are final, so they win over expiry. An unsent invite
 * that has also expired is shown as expired: resending is the fix either way,
 * and "expired" is the more urgent of the two to notice.
 */
export function getInviteStatus(invite: InviteDates, now: Date): InviteStatus {
  if (invite.acceptedAt) {
    return "accepted";
  }
  if (invite.revokedAt) {
    return "revoked";
  }
  if (invite.expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  if (!invite.sentAt) {
    return "not_sent";
  }
  return "pending";
}

/** Only a live invite can be accepted; slice 4 checks this on the link page. */
export function isInviteUsable(invite: InviteDates, now: Date): boolean {
  const status = getInviteStatus(invite, now);
  return status === "pending" || status === "not_sent";
}
