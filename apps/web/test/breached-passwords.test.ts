import { createHash } from "node:crypto";

import { createBreachedPasswordCheck } from "@fleetapp/auth";
import { describe, expect, it, vi } from "vitest";

const PASSWORD = "correct horse battery staple";
const FINGERPRINT = createHash("sha1").update(PASSWORD).digest("hex").toUpperCase();

function answering(body: string, status = 200): typeof fetch {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe("checking a password against known breaches", () => {
  it("sends only the first 5 characters of the fingerprint, never the password", async () => {
    const fetchSpy = answering("");
    await createBreachedPasswordCheck(fetchSpy)(PASSWORD);

    const [url] = vi.mocked(fetchSpy).mock.calls[0]!;
    expect(String(url)).toMatch(new RegExp(`/range/${FINGERPRINT.slice(0, 5)}$`));
    expect(String(url)).not.toContain(PASSWORD);
    expect(String(url)).not.toContain(FINGERPRINT.slice(5));
  });

  it("finds a listed password, and ignores padding lines with a count of 0", async () => {
    const suffix = FINGERPRINT.slice(5);
    expect(await createBreachedPasswordCheck(answering(`${suffix}:42`))(PASSWORD)).toBe(true);
    expect(await createBreachedPasswordCheck(answering(`${suffix}:0`))(PASSWORD)).toBe(false);
    expect(await createBreachedPasswordCheck(answering("ABCDEF:3"))(PASSWORD)).toBe(false);
  });

  it("allows the password when the service cannot be reached", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    expect(await createBreachedPasswordCheck(failing)(PASSWORD)).toBe(false);
    expect(await createBreachedPasswordCheck(answering("", 503))(PASSWORD)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
