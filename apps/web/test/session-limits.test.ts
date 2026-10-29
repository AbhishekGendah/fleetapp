import {
  ADMIN_SESSION,
  hasReachedSessionLimit,
  signInNotice,
  SIGNED_OUT_REASON_PARAM,
  SIGNED_OUT_TIME_LIMIT,
  USER_SESSION,
} from "@fleetapp/auth/login-policy";
import { MILLISECONDS_PER_SECOND } from "@fleetapp/core";
import { describe, expect, it } from "vitest";

const SIGNED_IN_AT = new Date("2026-10-29T08:00:00Z");

function after(seconds: number): Date {
  return new Date(SIGNED_IN_AT.getTime() + seconds * MILLISECONDS_PER_SECOND);
}

describe("the hard limit on a sign-in", () => {
  it("ends an Admin's sign-in at 8 hours, however active", () => {
    const limit = ADMIN_SESSION.maxAgeSeconds;
    expect(hasReachedSessionLimit(SIGNED_IN_AT, after(limit - 1), limit)).toBe(false);
    expect(hasReachedSessionLimit(SIGNED_IN_AT, after(limit), limit)).toBe(true);
  });

  it("ends a User's sign-in at 30 days", () => {
    const limit = USER_SESSION.maxAgeSeconds;
    expect(hasReachedSessionLimit(SIGNED_IN_AT, after(limit - 1), limit)).toBe(false);
    expect(hasReachedSessionLimit(SIGNED_IN_AT, after(limit + 1), limit)).toBe(true);
  });

  it("keeps the inactivity window shorter than the hard limit", () => {
    expect(ADMIN_SESSION.idleSeconds).toBeLessThan(ADMIN_SESSION.maxAgeSeconds);
    expect(USER_SESSION.idleSeconds).toBeLessThan(USER_SESSION.maxAgeSeconds);
  });
});

describe("the sign-in page's notice", () => {
  it("explains a time-limit sign-out, and says nothing otherwise", () => {
    const params = { [SIGNED_OUT_REASON_PARAM]: SIGNED_OUT_TIME_LIMIT };
    expect(signInNotice(params, ADMIN_SESSION)).toContain("8 hours");
    expect(signInNotice({}, ADMIN_SESSION)).toBeUndefined();
    expect(
      signInNotice({ [SIGNED_OUT_REASON_PARAM]: "something-else" }, USER_SESSION),
    ).toBeUndefined();
  });
});
