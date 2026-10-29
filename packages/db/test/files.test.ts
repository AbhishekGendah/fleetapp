import { randomUUID } from "node:crypto";

import { buildFileKey } from "@fleetapp/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";

const LOGO_SIZE_BYTES = 1234;

function logoRow(operatorId: string) {
  const id = randomUUID();
  return {
    id,
    operatorId,
    purpose: "operator_logo" as const,
    storageArea: "general" as const,
    objectKey: buildFileKey(operatorId, "operator_logo", id),
    contentType: "image/png",
    sizeBytes: LOGO_SIZE_BYTES,
  };
}

/** Files stay within their Operator; admin sees how much, never what. */
describe("file records", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let operatorBFileId: string;

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));

    await withTenant(web.db, operatorAId, (tx) =>
      tx.insert(schema.files).values(logoRow(operatorAId)),
    );
    const operatorBFile = logoRow(operatorBId);
    operatorBFileId = operatorBFile.id;
    await withTenant(web.db, operatorBId, (tx) => tx.insert(schema.files).values(operatorBFile));
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("shows an Operator only its own files", async () => {
    const rows = await withTenant(web.db, operatorAId, (tx) => tx.select().from(schema.files));

    expect(rows.map((row) => row.operatorId)).toEqual([operatorAId]);
  });

  it("cannot record a file for another Operator", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) => tx.insert(schema.files).values(logoRow(operatorBId))),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("cannot mark another Operator's file deleted", async () => {
    await withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.files)
        .set({ deletedAt: new Date() })
        .where(eq(schema.files.id, operatorBFileId)),
    );

    const [file] = await withTenant(web.db, operatorBId, (tx) =>
      tx.select().from(schema.files).where(eq(schema.files.id, operatorBFileId)),
    );
    expect(file?.deletedAt).toBeNull();
  });

  it("cannot move a file to another address, Operator or purpose", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorBId, (tx) =>
        tx
          .update(schema.files)
          .set({ objectKey: "elsewhere" })
          .where(eq(schema.files.id, operatorBFileId)),
      ),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("allows one logo in use per Operator", async () => {
    const now = new Date();
    const first = { ...logoRow(operatorAId), confirmedAt: now };
    const second = { ...logoRow(operatorAId), confirmedAt: now };
    await withTenant(web.db, operatorAId, (tx) => tx.insert(schema.files).values(first));

    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) => tx.insert(schema.files).values(second)),
    );
    expect(code).toBe("23505");
  });

  it("lets admin add up sizes, but not see addresses or types", async () => {
    const [usage] = await admin.db
      .select({ total: sql<number>`sum(${schema.files.sizeBytes})::int` })
      .from(schema.files)
      .where(eq(schema.files.operatorId, operatorBId));
    expect(usage?.total).toBe(LOGO_SIZE_BYTES);

    for (const column of [schema.files.objectKey, schema.files.contentType, schema.files.purpose]) {
      const code = await postgresErrorCodeOf(admin.db.select({ column }).from(schema.files));
      expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    }
  });

  it("lets nobody delete a file record", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorBId, (tx) =>
        tx.delete(schema.files).where(eq(schema.files.id, operatorBFileId)),
      ),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });
});
