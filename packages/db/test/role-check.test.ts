import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { assertSafeDatabaseRole, databaseRoleProblems, prepareServer } from "../src/role-check";
import { transactionProblems } from "../src/transaction-check";
import { connectAs, type TestConnection } from "./fixtures";

/** Each app refuses to start on a database login that would skip the tenant lock (review G1-4). */
describe("the start-up database login check", () => {
  const connections: TestConnection[] = [];
  const connect = (url: string) => {
    const connection = connectAs(url);
    connections.push(connection);
    return connection;
  };

  let roleUrls: string[];
  beforeAll(() => {
    roleUrls = [
      inject("webRoleUrl"),
      inject("adminRoleUrl"),
      inject("webAuthRoleUrl"),
      inject("adminAuthRoleUrl"),
    ];
  });

  afterAll(async () => {
    await Promise.all(connections.map((connection) => connection.close()));
  });

  it("passes each of the four app logins", async () => {
    for (const url of roleUrls) {
      expect(await databaseRoleProblems(connect(url).db)).toEqual([]);
    }
  });

  it("refuses the tables' owner and a superuser", async () => {
    expect(await databaseRoleProblems(connect(inject("ownerUrl")).db)).toContain(
      "it owns the app's tables",
    );
    await expect(
      assertSafeDatabaseRole(connect(inject("superuserUrl")).db, "test"),
    ).rejects.toThrow(/superuser/);
  });

  it("finds each app login's transactions held together", async () => {
    for (const url of roleUrls) {
      expect(await transactionProblems(connect(url).db)).toEqual([]);
    }
  });

  it("checks on connections of its own, leaving no pool for the app to pick up", async () => {
    const [webUrl, , webAuthUrl] = roleUrls;
    await prepareServer({ app: webUrl!, login: webAuthUrl! });

    const sharedPools = [...(globalThis.__fleetappDbPoolsByDriver?.values() ?? [])];
    expect(sharedPools.some((pools) => pools.has(webUrl!) || pools.has(webAuthUrl!))).toBe(false);
  });

  it("refuses to start on an unsafe login, after closing its connection", async () => {
    await expect(prepareServer({ app: inject("ownerUrl") })).rejects.toThrow(
      /owns the app's tables/,
    );
  });
});
