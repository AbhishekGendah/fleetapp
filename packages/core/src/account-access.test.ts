import { describe, expect, it } from "vitest";

import { getAccountAccess } from "./account-access";

const OPEN = { userArchivedAt: null, operatorSuspendedAt: null, operatorArchivedAt: null };
const MOMENT = new Date("2026-10-29T00:00:00Z");

describe("whether a User's login may be used", () => {
  it("is open when nothing is archived or suspended", () => {
    expect(getAccountAccess(OPEN)).toBe("open");
  });

  it("is suspended while the Operator is suspended", () => {
    expect(getAccountAccess({ ...OPEN, operatorSuspendedAt: MOMENT })).toBe("suspended");
  });

  it("is closed when the User or the Operator is archived, even if also suspended", () => {
    expect(getAccountAccess({ ...OPEN, userArchivedAt: MOMENT })).toBe("closed");
    expect(
      getAccountAccess({ ...OPEN, operatorArchivedAt: MOMENT, operatorSuspendedAt: MOMENT }),
    ).toBe("closed");
  });
});
