import { describe, expect, it } from "vitest";

import {
  LIST_PAGE_SIZE,
  listQueryString,
  matchingRows,
  pageOfRows,
  parseListQuery,
  missingListRules,
  type InMemoryListRules,
  type ListDefinition,
} from "./list-query";
import { exportTable, neutraliseSpreadsheetText, toCsv } from "./spreadsheet-cells";

interface Car {
  rego: string;
  status: "available" | "rented";
  odometer: number | null;
}

const CARS: Car[] = [
  { rego: "ABC123", status: "rented", odometer: 52000 },
  { rego: "XYZ789", status: "available", odometer: null },
  { rego: "abd456", status: "available", odometer: 1200 },
];

const CAR_LIST: ListDefinition<Car> = {
  columns: [
    { key: "rego", label: "Rego", isSortable: true, exportValue: (car) => car.rego },
    { key: "odometer", label: "Odometer", isSortable: true, exportValue: (car) => car.odometer },
    { key: "status", label: "Status", exportValue: (car) => car.status },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "available", label: "Available" },
        { value: "rented", label: "Rented" },
      ],
    },
  ],
  defaultSort: { column: "rego", direction: "asc" },
};

const CAR_RULES: InMemoryListRules<Car> = {
  searchText: (car) => car.rego,
  sortValues: { rego: (car) => car.rego, odometer: (car) => car.odometer },
  filterMatches: { status: (car, value) => car.status === value },
};

const regos = (cars: Car[]) => cars.map((car) => car.rego);

describe("reading a list's query from the page address", () => {
  it("keeps what the list allows and drops the rest", () => {
    const query = parseListQuery(CAR_LIST, {
      q: "  ab ",
      sort: "odometer",
      dir: "asc",
      status: "rented",
      page: "2",
    });
    expect(query).toEqual({
      search: "ab",
      sort: { column: "odometer", direction: "asc" },
      filters: { status: "rented" },
      page: 2,
    });
  });

  it("falls back to the defaults for anything it does not recognise", () => {
    const query = parseListQuery(CAR_LIST, { sort: "status", status: "stolen", page: "-3" });
    expect(query).toEqual({ search: "", sort: CAR_LIST.defaultSort, filters: {}, page: 1 });
  });
});

describe("applying a list's query", () => {
  it("searches without caring about capitals, and filters", () => {
    const query = parseListQuery(CAR_LIST, { q: "AB", status: "available" });
    expect(regos(matchingRows(CARS, CAR_RULES, query))).toEqual(["abd456"]);
  });

  it("sorts either way, with blanks last both times", () => {
    const ascending = parseListQuery(CAR_LIST, { sort: "odometer", dir: "asc" });
    const descending = parseListQuery(CAR_LIST, { sort: "odometer", dir: "desc" });
    expect(regos(matchingRows(CARS, CAR_RULES, ascending))).toEqual(["abd456", "ABC123", "XYZ789"]);
    expect(regos(matchingRows(CARS, CAR_RULES, descending))).toEqual(["ABC123", "abd456", "XYZ789"]);
  });

  it("pages, and shows the last page for a page past the end", () => {
    const many = Array.from({ length: LIST_PAGE_SIZE + 5 }, (_, index) => ({
      rego: `CAR${String(index).padStart(3, "0")}`,
      status: "available" as const,
      odometer: index,
    }));
    const page = pageOfRows(many, CAR_RULES, parseListQuery(CAR_LIST, { page: "9" }));
    expect(page).toMatchObject({ total: LIST_PAGE_SIZE + 5, page: 2, pageCount: 2 });
    expect(page.rows).toHaveLength(5);
  });

  it("writes the query back into an address, leaving out the defaults", () => {
    const query = parseListQuery(CAR_LIST, { q: "ab", status: "rented" });
    expect(listQueryString(CAR_LIST, query, { page: 3 })).toBe("?q=ab&status=rented&page=3");
    expect(listQueryString(CAR_LIST, parseListQuery(CAR_LIST, {}))).toBe("");
  });
});

describe("exporting a list", () => {
  it("makes a cell that starts like a formula plain text, but leaves numbers alone", () => {
    expect(neutraliseSpreadsheetText('=HYPERLINK("http://evil")')).toBe(
      '\'=HYPERLINK("http://evil")',
    );
    expect(neutraliseSpreadsheetText("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutraliseSpreadsheetText("Smith")).toBe("Smith");
    const table = exportTable(CAR_LIST.columns, [
      { rego: "+61400", status: "rented", odometer: -5 },
    ]);
    expect(table[1]).toEqual(["'+61400", -5, "rented"]);
  });

  it("writes CSV that spreadsheet programs read correctly", () => {
    const csv = toCsv([
      ["Name", "Note"],
      ["Smith, Jo", 'Said "hi"'],
      ["Lee", null],
    ]);
    expect(csv).toBe('﻿Name,Note\r\n"Smith, Jo","Said ""hi"""\r\nLee,');
  });
});

describe("missingListRules", () => {
  it("is empty when every sortable column and filter is covered", () => {
    expect(
      missingListRules(CAR_LIST, {
        sortKeys: Object.keys(CAR_RULES.sortValues),
        filterKeys: Object.keys(CAR_RULES.filterMatches),
      }),
    ).toEqual([]);
  });

  it("names what is not covered", () => {
    expect(missingListRules(CAR_LIST, { sortKeys: ["rego"], filterKeys: [] })).toEqual([
      "odometer",
      "status",
    ]);
  });
});
