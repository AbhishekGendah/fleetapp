import { createHash } from "node:crypto";

import { createBreachedPasswordCheck } from "@fleetapp/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

const PASSWORD = "correct horse battery staple";
const FINGERPRINT = createHash("sha1").update(PASSWORD).digest("hex").toUpperCase();

/** Stands in for the network: the check is Better Auth's, which uses the global fetch. */
function answering(body: string, status = 200): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

const check = createBreachedPasswordCheck();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checking a password against known breaches", () => {
  it("sends only the first 5 characters of the fingerprint, never the password", async () => {
    const fetchSpy = answering("");
    await check(PASSWORD);

    const [url] = fetchSpy.mock.calls[0] as unknown[];
    expect(String(url)).toMatch(new RegExp(`/range/${FINGERPRINT.slice(0, 5)}$`));
    expect(String(url)).not.toContain(PASSWORD);
    expect(String(url)).not.toContain(FINGERPRINT.slice(5));
  });

  it("finds a listed password, and ignores padding lines with a count of 0", async () => {
    const suffix = FINGERPRINT.slice(5);
    answering(`${suffix}:42`);
    expect(await check(PASSWORD)).toBe(true);
    answering(`${suffix}:0`);
    expect(await check(PASSWORD)).toBe(false);
    answering("ABCDEF:3");
    expect(await check(PASSWORD)).toBe(false);
  });

  it("allows the password when the service cannot be reached", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    expect(await check(PASSWORD)).toBe(false);
    answering("", 503);
    expect(await check(PASSWORD)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
