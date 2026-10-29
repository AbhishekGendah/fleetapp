import { LIST_PAGE_SIZE, type ListQuery } from "@fleetapp/core";
import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { listConditions, listOrderBy, loadListPage, type DatabaseListRules } from "../src/list-query";
import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import { connectAs, seedTwoOperators, type TestConnection } from "./fixtures";

const { vehicles } = schema;

const RULES: DatabaseListRules = {
  searchIn: [vehicles.rego, vehicles.make, vehicles.model],
  sortBy: { rego: vehicles.rego, colour: vehicles.colour, year: vehicles.year },
  filterBy: { status: (value) => sql`${vehicles.status} = ${value}` },
  tieBreaker: vehicles.id,
};

function queryOf(changes: Partial<ListQuery>): ListQuery {
  return { search: "", sort: { column: "rego", direction: "asc" }, filters: {}, page: 1, ...changes };
}

/** The database version of the shared list rules, against real Postgres. */
describe("database lists", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorId: string;

  async function regosFor(query: ListQuery): Promise<string[]> {
    const rows = await withTenant(web.db, operatorId, (tx) =>
      tx
        .select({ rego: vehicles.rego })
        .from(vehicles)
        .where(and(eq(vehicles.operatorId, operatorId), listConditions(RULES, query)))
        .orderBy(...listOrderBy(RULES, query)),
    );
    return rows.map((row) => row.rego);
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId: operatorId } = await seedTwoOperators(admin.db));
    const car = { operatorId, regoState: "WA" as const, year: 2020 };
    await withTenant(web.db, operatorId, (tx) =>
      tx.insert(vehicles).values([
        { ...car, rego: "AAA111", make: "Toyota", model: "Camry", colour: "White" },
        { ...car, rego: "BBB222", make: "Toyota", model: "Corolla", colour: null },
        { ...car, rego: "CCC333", make: "Kia", model: "Niro 50%", colour: "Blue", status: "sold" },
      ]),
    );
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("finds rows with every word somewhere in them", async () => {
    expect(await regosFor(queryOf({ search: "camry toyota" }))).toEqual(["AAA111"]);
    expect(await regosFor(queryOf({ search: "TOYOTA" }))).toEqual(["AAA111", "BBB222"]);
  });

  it("treats % and _ in a search as plain characters", async () => {
    expect(await regosFor(queryOf({ search: "50%" }))).toEqual(["CCC333"]);
    expect(await regosFor(queryOf({ search: "A_A" }))).toEqual([]);
  });

  it("applies filters", async () => {
    expect(await regosFor(queryOf({ filters: { status: "sold" } }))).toEqual(["CCC333"]);
  });

  it("sorts either way with blanks last", async () => {
    const byColour = (direction: "asc" | "desc") =>
      regosFor(queryOf({ sort: { column: "colour", direction } }));
    expect(await byColour("asc")).toEqual(["CCC333", "AAA111", "BBB222"]);
    expect(await byColour("desc")).toEqual(["AAA111", "CCC333", "BBB222"]);
  });

  it("pages, showing the last page for a page past the end", async () => {
    const extra = Array.from({ length: LIST_PAGE_SIZE }, (_, index) => ({
      operatorId,
      regoState: "NSW" as const,
      rego: `PAGE${String(index).padStart(2, "0")}`,
      make: "Mazda",
      model: "CX-5",
      year: 2021,
    }));
    await withTenant(web.db, operatorId, (tx) => tx.insert(vehicles).values(extra));

    const query = queryOf({ search: "mazda", page: 9 });
    const page = await withTenant(web.db, operatorId, (tx) => {
      const where = and(eq(vehicles.operatorId, operatorId), listConditions(RULES, query));
      return loadListPage(query, {
        count: async () => (await tx.select({ total: count() }).from(vehicles).where(where))[0]!.total,
        rows: ({ offset, limit }) =>
          tx
            .select({ rego: vehicles.rego })
            .from(vehicles)
            .where(where)
            .orderBy(...listOrderBy(RULES, query))
            .limit(limit)
            .offset(offset),
      });
    });

    expect(page).toMatchObject({ total: LIST_PAGE_SIZE, page: 1, pageCount: 1 });
    expect(page.rows).toHaveLength(LIST_PAGE_SIZE);
  });
});
