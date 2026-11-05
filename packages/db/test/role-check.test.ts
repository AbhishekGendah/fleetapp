import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { assertSafeDatabaseRole, databaseRoleProblems } from "../src/role-check";
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
});
