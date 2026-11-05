import { afterEach, describe, expect, it, vi } from "vitest";

import { installSafeErrorLogging } from "./safe-console";

const RENTER = "Sam Renter 0412 345 678";

describe("server error logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never writes an error's message or a query's values (review A7-1)", () => {
    const written: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
      written.push(values);
    });
    installSafeErrorLogging();
    console.error(new Error(`Failed query: select ... params: ${RENTER}`));
    console.error(`⨯ Failed query: select * from renters params: ${RENTER}`);
    expect(JSON.stringify(written)).not.toContain(RENTER);
    expect(written).toHaveLength(2);
  });
});
