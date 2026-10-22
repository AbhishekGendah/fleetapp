import { describe, expect, it } from "vitest";

import type { InviteDates } from "./invites";
import { getOperatorStatus } from "./operator-status";

const NOW = new Date("2026-10-05T00:00:00Z");
const EARLIER = new Date("2026-10-01T00:00:00Z");
const LATER = new Date("2026-10-08T00:00:00Z");

const pendingInvite: InviteDates = {
  expiresAt: LATER,
  sentAt: EARLIER,
  acceptedAt: null,
  revokedAt: null,
};

describe("operator status", () => {
  it("is suspended whatever the invite says", () => {
    expect(getOperatorStatus({ suspendedAt: EARLIER, latestInvite: pendingInvite }, NOW)).toBe(
      "suspended",
    );
    expect(
      getOperatorStatus(
        { suspendedAt: EARLIER, latestInvite: { ...pendingInvite, acceptedAt: EARLIER } },
        NOW,
      ),
    ).toBe("suspended");
  });

  it("follows the latest invite otherwise", () => {
    const statusFor = (invite: InviteDates | null) =>
      getOperatorStatus({ suspendedAt: null, latestInvite: invite }, NOW);

    expect(statusFor(pendingInvite)).toBe("invited");
    expect(statusFor({ ...pendingInvite, acceptedAt: EARLIER })).toBe("active");
    expect(statusFor({ ...pendingInvite, sentAt: null })).toBe("invite_not_sent");
    expect(statusFor({ ...pendingInvite, expiresAt: EARLIER })).toBe("invite_expired");
    expect(statusFor({ ...pendingInvite, revokedAt: EARLIER })).toBe("no_invite");
    expect(statusFor(null)).toBe("no_invite");
  });
});
