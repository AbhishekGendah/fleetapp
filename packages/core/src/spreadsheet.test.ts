import { describe, expect, it } from "vitest";

import { toXlsx, toXlsxWorkbook } from "./spreadsheet";

/** An .xlsx file is a zip archive, which always starts with these two letters. */
const ZIP_START = "PK";

describe("writing an Excel file", () => {
  it("produces a real spreadsheet file from an export table", async () => {
    const file = await toXlsx([
      ["Rego", "Odometer", "Added"],
      ["ABC123", 52000, new Date("2026-10-29T00:00:00Z")],
      ["'=1+1", null, null],
    ]);
    expect(file.subarray(0, 2).toString()).toBe(ZIP_START);
    expect(file.byteLength).toBeGreaterThan(1000);
  });
});

describe("a workbook of several sheets", () => {
  it("is one Excel file", async () => {
    const file = await toXlsxWorkbook([
      { name: "Details", table: [["Name", "Sam"]] },
      {
        name: "Notes",
        table: [
          ["When", "Note"],
          [new Date("2026-10-30T01:00:00Z"), "Late"],
        ],
      },
    ]);
    expect(file.subarray(0, 2).toString()).toBe("PK");
  });
});
