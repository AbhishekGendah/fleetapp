import { describe, expect, it } from "vitest";

import { describeErrorForLog } from "./error-for-log";

describe("describing an error for a log", () => {
  it("never includes the message, which can quote personal data", () => {
    const error = new Error("insert failed, params: jo@example.test,0412 345 678");

    expect(JSON.stringify(describeErrorForLog(error))).not.toContain("example.test");
    expect(describeErrorForLog(error)).toEqual({ errorType: "Error" });
  });

  it("keeps the Postgres code and constraint from a wrapped database error", () => {
    const error = Object.assign(new Error("wrapped"), {
      cause: { code: "23505", constraint: "users_email_unique", detail: "jo@example.test" },
    });

    expect(describeErrorForLog(error)).toEqual({
      errorType: "Error",
      code: "23505",
      constraint: "users_email_unique",
    });
  });

  it("copes with things that are not errors", () => {
    expect(describeErrorForLog("oops")).toEqual({ errorType: "string" });
    expect(describeErrorForLog(null)).toEqual({ errorType: "object" });
  });
});
