import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runMigrations } from "../src/migrate";
import { ADMIN_APP_ROLE, WEB_APP_ROLE } from "../src/tenancy";
import { asRole, OWNER_ROLE, updatesUpTo, urlFor } from "./filled-database";

/** The last update before a retired business's statements are binned (0062). */
const LAST_UPDATE_BEFORE = "0061_renter_statements";
const DATABASE_NAME = `business_statement_retention_${process.pid}`;
const FINGERPRINT = "c".repeat(64);

/**
 * Retiring a business Renter bins its own statements across its cars (0062,
 * slice 5 review), on a database filled at 0061 the way that code fills it:
 * before the update the job left them; after it, they go with the business,
 * another Operator's stay, and a person's papers go as before.
 */
describe("the business statement retention update on a filled database", () => {
  let superuser: Client;
  let web: Client;
  const folder = mkdtempSync(path.join(tmpdir(), "business-statement-retention-"));
  const filled: Record<string, string> = {};
  let fileCount = 0;
  const url = (role: string, base: string) => urlFor(role, base, DATABASE_NAME);
  const asWeb = <Row extends Record<string, unknown>>(
    operatorId: string,
    query: string,
    values: unknown[] = [],
  ) => asRole<Row>(web, operatorId, query, values);

  async function addOperator(name: string): Promise<string> {
    const admin = new Client({ connectionString: url(ADMIN_APP_ROLE, inject("adminRoleUrl")) });
    await admin.connect();
    const [operator] = await asRole<{ id: string }>(
      admin,
      null,
      `insert into operators (legal_name) values ($1) returning id`,
      [name],
    );
    await admin.end();
    return operator!.id;
  }

  async function storedPdf(operatorId: string): Promise<string> {
    fileCount += 1;
    const [file] = await asWeb<{ id: string }>(
      operatorId,
      `insert into files (operator_id, purpose, storage_area, object_key, content_type, size_bytes, confirmed_at)
       values ($1, 'issued_document', 'general', $2, 'application/pdf', 2048, now()) returning id`,
      [operatorId, `${operatorId}/issued_document/filled-062-${fileCount}.pdf`],
    );
    return file!.id;
  }

  /** An idle business, added eight years back, with a statement of its own (as 0061's code makes one). */
  async function oldBusinessWithStatement(operatorId: string, name: string) {
    const [business] = await asWeb<{ id: string }>(
      operatorId,
      `insert into renters (operator_id, kind, full_name, email, contact_name)
       values ($1, 'organisation', $2, 'dana@example.test', 'Dana Wells') returning id`,
      [operatorId, name],
    );
    const fileId = await storedPdf(operatorId);
    await asWeb(
      operatorId,
      `insert into issued_documents (operator_id, renter_id, kind, version, file_id, sha256)
       values ($1, $2, 'statement', 1, $3, $4)`,
      [operatorId, business!.id, fileId, FINGERPRINT],
    );
    return { renterId: business!.id, fileId };
  }

  /** An idle person, eight years back, whose cancelled booking has a statement. */
  async function oldPersonWithRentalPaper(operatorId: string) {
    const [person] = await asWeb<{ id: string }>(
      operatorId,
      `insert into renters (operator_id, full_name, email) values ($1, 'Pat Old', 'pat@example.test')
       returning id`,
      [operatorId],
    );
    const [car] = await asWeb<{ id: string }>(
      operatorId,
      `insert into vehicles (operator_id, rego, rego_state, make, model, year)
       values ($1, 'FIL062', 'WA', 'Kia', 'Niro', 2023) returning id`,
      [operatorId],
    );
    const [rental] = await asWeb<{ id: string }>(
      operatorId,
      `insert into rentals (operator_id, renter_id, vehicle_id, type, status, planned_start,
         planned_end, charge_weekday, bond_cents, settings_snapshot, settings_version)
       values ($1, $2, $3, 'fixed_term', 'draft', now() + interval '2 days', now() + interval '30 days',
         2, 0, '{}', 1)
       returning id`,
      [operatorId, person!.id, car!.id],
    );
    const fileId = await storedPdf(operatorId);
    await asWeb(
      operatorId,
      `insert into issued_documents (operator_id, rental_id, kind, version, file_id, sha256)
       values ($1, $2, 'statement', 1, $3, $4)`,
      [operatorId, rental!.id, fileId, FINGERPRINT],
    );
    await superuser.query("begin");
    await superuser.query("set local session_replication_role = replica");
    await superuser.query(
      `update rentals set status = 'cancelled', cancelled_at = now() - interval '8 years',
         cancellation_reason = 'Changed plans', created_at = now() - interval '8 years 7 days'
       where id = $1`,
      [rental!.id],
    );
    await superuser.query("commit");
    return { renterId: person!.id, fileId };
  }

  /** Added eight years back, as the job's seven-year clock needs. */
  async function dateBack(renterIds: readonly string[]): Promise<void> {
    await superuser.query("begin");
    await superuser.query("set local session_replication_role = replica");
    await superuser.query(
      `update renters set created_at = now() - interval '8 years 7 days' where id = any($1)`,
      [renterIds],
    );
    await superuser.query("commit");
  }

  const retire = async (operatorId: string, renterId: string) =>
    (
      await asWeb<{ retired: boolean }>(operatorId, "select app.retire_renter($1) as retired", [
        renterId,
      ])
    )[0]?.retired;
  const isBinned = async (operatorId: string, fileId: string) =>
    (
      await asWeb<{ binned: boolean }>(
        operatorId,
        "select deleted_at is not null as binned from files where id = $1",
        [fileId],
      )
    )[0]?.binned;

  beforeAll(async () => {
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    await superuser.query(`CREATE DATABASE ${DATABASE_NAME} OWNER ${OWNER_ROLE}`);
    updatesUpTo(LAST_UPDATE_BEFORE, folder);
    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")), folder);
    await superuser.end();
    const inTestDatabase = new URL(inject("superuserUrl"));
    inTestDatabase.pathname = `/${DATABASE_NAME}`;
    superuser = new Client({ connectionString: inTestDatabase.toString() });
    await superuser.connect();
    web = new Client({ connectionString: url(WEB_APP_ROLE, inject("webRoleUrl")) });
    await web.connect();

    filled.operatorId = await addOperator("Filled Retention Pty Ltd");
    filled.otherOperatorId = await addOperator("Other Retention Pty Ltd");
    const before = await oldBusinessWithStatement(filled.operatorId, "Before Rides Pty Ltd");
    const after = await oldBusinessWithStatement(filled.operatorId, "After Rides Pty Ltd");
    const other = await oldBusinessWithStatement(filled.otherOperatorId, "After Rides Pty Ltd");
    const person = await oldPersonWithRentalPaper(filled.operatorId);
    Object.assign(filled, {
      beforeFileId: before.fileId,
      afterId: after.renterId,
      afterFileId: after.fileId,
      otherId: other.renterId,
      otherFileId: other.fileId,
      personId: person.renterId,
      personFileId: person.fileId,
    });
    await dateBack([before.renterId, after.renterId, other.renterId, person.renterId]);

    // Before the update, retiring a business left its statement's PDF (the gap).
    expect(await retire(filled.operatorId, before.renterId)).toBe(true);
    expect(await isBinned(filled.operatorId, before.fileId)).toBe(false);

    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")));
  });

  afterAll(async () => {
    await web?.end();
    await superuser?.end();
    const cleaner = new Client({ connectionString: inject("superuserUrl") });
    await cleaner.connect();
    await cleaner.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME} WITH (FORCE)`);
    await cleaner.end();
    rmSync(folder, { recursive: true, force: true });
  });

  it("bins a retired business's own statements with it, keeping the documents' rows", async () => {
    expect(await retire(filled.operatorId!, filled.afterId!)).toBe(true);

    expect(await isBinned(filled.operatorId!, filled.afterFileId!)).toBe(true);
    const kept = await asWeb<{ count: number }>(
      filled.operatorId!,
      "select count(*)::int as count from issued_documents where renter_id = $1",
      [filled.afterId],
    );
    expect(kept[0]?.count).toBe(1);
  });

  it("leaves another Operator's business's statements as they are", async () => {
    expect(await isBinned(filled.otherOperatorId!, filled.otherFileId!)).toBe(false);
    // Its own retirement bins it, within its own Operator only.
    expect(await retire(filled.otherOperatorId!, filled.otherId!)).toBe(true);
    expect(await isBinned(filled.otherOperatorId!, filled.otherFileId!)).toBe(true);
  });

  it("bins a person's rental papers at their retirement as before", async () => {
    expect(await isBinned(filled.operatorId!, filled.personFileId!)).toBe(false);

    expect(await retire(filled.operatorId!, filled.personId!)).toBe(true);

    expect(await isBinned(filled.operatorId!, filled.personFileId!)).toBe(true);
  });

  it("still keeps a current business's statement from being binned by the app", async () => {
    const current = await oldBusinessWithStatement(filled.operatorId!, "Current Rides Pty Ltd");
    await expect(
      asWeb(filled.operatorId!, "update files set deleted_at = now() where id = $1", [
        current.fileId,
      ]),
    ).rejects.toThrow(/kept for good/);
  });
});
