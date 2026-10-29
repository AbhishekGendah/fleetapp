import { describe, expect, it } from "vitest";

import { joinUrl } from "./urls";

describe("joining a path onto an address", () => {
  it("gives one slash whether or not the address ends in one", () => {
    expect(joinUrl("https://example.test", "/sign-in")).toBe("https://example.test/sign-in");
    expect(joinUrl("https://example.test//", "/sign-in")).toBe("https://example.test/sign-in");
  });
});
