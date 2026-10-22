import { describe, expect, it } from "vitest";

import { renderOperatorInviteEmail } from "./render-operator-invite";

const ACCEPT_URL = "https://app.example.test/invite/a-secret-token";

describe("the Operator invite email", () => {
  it("carries the link in both the HTML and the plain-text version", async () => {
    const message = await renderOperatorInviteEmail({
      to: "user@example.test",
      inviteeName: "Sam",
      operatorName: "Sam's Cars Pty Ltd",
      acceptUrl: ACCEPT_URL,
    });

    expect(message.to).toBe("user@example.test");
    expect(message.subject).toContain("Sam's Cars Pty Ltd");
    expect(message.html).toContain(ACCEPT_URL);
    expect(message.text).toContain(ACCEPT_URL);
    expect(message.text).toContain("7 days");
  });

  it("escapes names, so an Operator name cannot inject markup", async () => {
    const message = await renderOperatorInviteEmail({
      to: "user@example.test",
      inviteeName: "Sam",
      operatorName: "<script>alert(1)</script>",
      acceptUrl: ACCEPT_URL,
    });

    expect(message.html).not.toContain("<script>");
  });
});
