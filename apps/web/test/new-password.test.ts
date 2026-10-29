import {
  MINIMUM_PASSWORD_LENGTH,
  newPasswordSchema,
  PASSWORDS_DIFFER_MESSAGE,
} from "@fleetapp/auth/login-policy";
import { describe, expect, it } from "vitest";

const LONG_ENOUGH = "a".repeat(MINIMUM_PASSWORD_LENGTH);

describe("the new-password rule", () => {
  it("accepts a long enough password typed the same twice", () => {
    expect(
      newPasswordSchema.safeParse({ password: LONG_ENOUGH, confirmation: LONG_ENOUGH }).success,
    ).toBe(true);
  });

  it("refuses a short password, and two that differ", () => {
    const short = "a".repeat(MINIMUM_PASSWORD_LENGTH - 1);
    expect(newPasswordSchema.safeParse({ password: short, confirmation: short }).success).toBe(
      false,
    );

    const differing = newPasswordSchema.safeParse({
      password: LONG_ENOUGH,
      confirmation: `${LONG_ENOUGH}b`,
    });
    expect(differing.error?.issues[0]).toMatchObject({
      path: ["confirmation"],
      message: PASSWORDS_DIFFER_MESSAGE,
    });
  });
});
