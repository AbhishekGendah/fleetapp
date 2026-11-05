import { safeAuthLogger } from "@fleetapp/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

const PERSONAL = "sam@example.test";

/** The login system's errors never reach the hosting logs with personal details (review A2-2). */
describe("the login system's logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs an error by its type only, never its message or the query's values", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error(`Failed query: select ... params: ${PERSONAL}`);
    safeAuthLogger.log("error", `Failed query params: ${PERSONAL}`, error);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(PERSONAL);
    expect(logged).toHaveBeenCalledOnce();
  });

  it("keeps a warning to its first line, without its extra values", () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    safeAuthLogger.log("warn", "Rate limit reached\\nfor sam", { email: PERSONAL });
    expect(JSON.stringify(warned.mock.calls)).not.toContain(PERSONAL);
  });
});
