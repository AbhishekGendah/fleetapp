import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { findMigrationProblems } from "../src/migration-check";
import { describeMigrationFailure, runMigrations } from "../src/migrate";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_DATE = 1_800_000_000_000;

interface FakeMigration {
  tag: string;
  when: number;
  sql: string;
}

/** A folder of update files and a journal, as drizzle-kit writes them. */
function writeMigrations(folder: string, migrations: readonly FakeMigration[]): void {
  mkdirSync(path.join(folder, "meta"), { recursive: true });
  for (const migration of migrations) {
    writeFileSync(path.join(folder, `${migration.tag}.sql`), migration.sql);
  }
  const entries = migrations.map((migration, idx) => ({
    idx,
    version: "7",
    when: migration.when,
    tag: migration.tag,
    breakpoints: true,
  }));
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries }),
  );
}

const table = (name: string, day: number): FakeMigration => ({
  tag: `000${day}_${name}`,
  when: FIRST_DATE + day * DAY_MS,
  sql: `CREATE TABLE "${name}" ("id" integer);`,
});

describe("the database update checks", () => {
  it("find an edited, an out-of-order and an unknown update", () => {
    const repo = [
      { tag: "0000_a", folderMillis: 1, hash: "a" },
      { tag: "0001_b", folderMillis: 2, hash: "b-edited" },
      { tag: "0002_late", folderMillis: 3, hash: "late" },
    ];
    const applied = [
      { hash: "a", createdAt: 1 },
      { hash: "b", createdAt: 2 },
      { hash: "c", createdAt: 4 },
    ];

    expect(findMigrationProblems(repo, applied)).toEqual([
      expect.stringMatching(/^0001_b was changed after it ran/),
      expect.stringMatching(/dated 4 that is not in the repo/),
      expect.stringMatching(/^0002_late is older than updates already run/),
    ]);
    expect(findMigrationProblems(repo.slice(0, 1), applied.slice(0, 1))).toEqual([]);
  });

  it("find a journal out of date order", () => {
    const repo = [
      { tag: "0000_a", folderMillis: 5, hash: "a" },
      { tag: "0001_b", folderMillis: 5, hash: "b" },
    ];

    expect(findMigrationProblems(repo, [])).toEqual([
      expect.stringMatching(/^0001_b is dated no later than 0000_a/),
    ]);
  });
});

describe("a failed update, as logged", () => {
  it("keeps the code and names, and blanks any value from a row (rule 7)", () => {
    const cause = Object.assign(
      new Error('invalid input syntax for type uuid: "sam.smith@example.test"'),
      { code: "22P02", table: "renters", column: "id" },
    );

    expect(describeMigrationFailure(new Error("Failed query", { cause }))).toEqual({
      errorType: "Error",
      code: "22P02",
      table: "renters",
      column: "id",
      message: 'invalid input syntax for type uuid: "…"',
    });
  });
});

describe("running database updates (review G1-1)", () => {
  let superuser: Client;
  let databaseUrl: string;
  const databaseName = `migrate_check_${process.pid}`;
  const folder = mkdtempSync(path.join(tmpdir(), "migrate-check-"));

  beforeAll(async () => {
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    await superuser.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(inject("superuserUrl"));
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
  });

  afterAll(async () => {
    await superuser.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await superuser.end();
    rmSync(folder, { recursive: true, force: true });
  });

  it("runs the waiting ones once, two runs at once never overlapping", async () => {
    writeMigrations(folder, [table("first", 0), table("second", 1)]);

    const counts = await Promise.all([
      runMigrations(databaseUrl, folder),
      runMigrations(databaseUrl, folder),
    ]);

    expect(counts.sort()).toEqual([0, 2]);
    expect(await runMigrations(databaseUrl, folder)).toBe(0);
  });

  it("refuses to run when an update that ran has been edited, changing nothing", async () => {
    writeMigrations(folder, [table("first", 0), table("second", 1), table("third", 2)]);
    const edited = path.join(folder, `${table("second", 1).tag}.sql`);
    const original = readFileSync(edited, "utf8");
    writeFileSync(edited, `${original}\nALTER TABLE "second" ADD COLUMN "sneaky" text;`);

    await expect(runMigrations(databaseUrl, folder)).rejects.toThrow(
      /second was changed after it ran/,
    );
    // The waiting "third" was not run either: the check stops everything.
    const database = new Client({ connectionString: databaseUrl });
    await database.connect();
    const third = await database.query(`select to_regclass('third') as name`);
    await database.end();
    expect(third.rows[0]?.name).toBeNull();
    writeFileSync(edited, original);
  });

  it("refuses an update older than ones already run, rather than skipping it", async () => {
    writeMigrations(folder, [table("first", 0), table("second", 1), table("third", 3)]);
    expect(await runMigrations(databaseUrl, folder)).toBe(1);

    const merged = [table("first", 0), table("second", 1), table("between", 2), table("third", 3)];
    writeMigrations(folder, merged);

    await expect(runMigrations(databaseUrl, folder)).rejects.toThrow(
      /older than updates already run/,
    );
  });

  it("refuses when the database has run an update the repo doesn't have", async () => {
    writeMigrations(folder, [table("first", 0), table("second", 1)]);

    await expect(runMigrations(databaseUrl, folder)).rejects.toThrow(/not in the repo/);
  });
});
