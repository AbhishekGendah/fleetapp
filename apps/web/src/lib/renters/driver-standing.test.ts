import { describe, expect, it } from "vitest";

import { driverBadge, driverLicenceWords, type DriverStanding } from "./driver-standing";

const EXPIRY = { today: "2026-11-08", warningDays: 30 };
const CURRENT: DriverStanding = {
  status: "active",
  licenceType: "full",
  licenceIssuedIn: "WA",
  licenceCountry: null,
  licenceExpiresOn: "2029-06-03",
  isWaitingReview: false,
};

describe("a driver's standing on a business's pages", () => {
  it("says Current for a licence in date, with its kind, state and expiry, never its number", () => {
    expect(driverBadge(CURRENT, EXPIRY)).toEqual({ text: "Current", tone: "good" });
    expect(driverLicenceWords(CURRENT)).toBe("Full · WA · to 3 June 2029");
  });

  it("puts Do not rent first, then details to review, then the licence", () => {
    expect(
      driverBadge({ ...CURRENT, status: "do_not_rent", isWaitingReview: true }, EXPIRY).text,
    ).toBe("Do not rent");
    expect(driverBadge({ ...CURRENT, isWaitingReview: true }, EXPIRY).text).toBe("To review");
    expect(driverBadge({ ...CURRENT, licenceExpiresOn: null }, EXPIRY).text).toBe(
      "Licence not on file",
    );
    expect(driverBadge({ ...CURRENT, licenceExpiresOn: "2026-11-01" }, EXPIRY).text).toBe(
      "Licence expired",
    );
    expect(driverBadge({ ...CURRENT, licenceExpiresOn: "2026-12-01" }, EXPIRY).text).toBe(
      "Licence due",
    );
    expect(driverLicenceWords({ ...CURRENT, licenceType: null })).toBe("No licence on file yet");
  });
});
