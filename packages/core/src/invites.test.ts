import { describe, expect, it } from "vitest";

import { getInviteExpiry, getInviteStatus, isInviteUsable, type InviteDates } from "./invites";

const ISSUED_AT = new Date("2026-10-01T00:00:00Z");
const EXPIRES_AT = new Date("2026-10-08T00:00:00Z");
const BEFORE_EXPIRY = new Date("2026-10-07T23:59:59Z");

const sentInvite: InviteDates = {
  expiresAt: EXPIRES_AT,
  sentAt: ISSUED_AT,
  acceptedAt: null,
  revokedAt: null,
};

describe("invites", () => {
  it("expire seven days after they are issued", () => {
    expect(getInviteExpiry(ISSUED_AT)).toEqual(EXPIRES_AT);
  });

  it("are pending once sent, until they expire", () => {
    expect(getInviteStatus(sentInvite, BEFORE_EXPIRY)).toBe("pending");
  });

  it("are expired from the exact moment of expiry", () => {
    expect(getInviteStatus(sentInvite, EXPIRES_AT)).toBe("expired");
  });

  it("show as not sent when the email never went", () => {
    expect(getInviteStatus({ ...sentInvite, sentAt: null }, BEFORE_EXPIRY)).toBe("not_sent");
  });

  it("show an unsent, expired invite as expired", () => {
    expect(getInviteStatus({ ...sentInvite, sentAt: null }, EXPIRES_AT)).toBe("expired");
  });

  it("stay accepted or revoked after their expiry", () => {
    expect(getInviteStatus({ ...sentInvite, acceptedAt: ISSUED_AT }, EXPIRES_AT)).toBe("accepted");
    expect(getInviteStatus({ ...sentInvite, revokedAt: ISSUED_AT }, EXPIRES_AT)).toBe("revoked");
  });

  it("can be used only while pending or not sent", () => {
    expect(isInviteUsable(sentInvite, BEFORE_EXPIRY)).toBe(true);
    expect(isInviteUsable({ ...sentInvite, sentAt: null }, BEFORE_EXPIRY)).toBe(true);
    expect(isInviteUsable(sentInvite, EXPIRES_AT)).toBe(false);
    expect(isInviteUsable({ ...sentInvite, revokedAt: ISSUED_AT }, BEFORE_EXPIRY)).toBe(false);
    expect(isInviteUsable({ ...sentInvite, acceptedAt: ISSUED_AT }, BEFORE_EXPIRY)).toBe(false);
  });
});
