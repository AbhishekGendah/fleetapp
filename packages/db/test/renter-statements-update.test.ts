import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runMigrations } from "../src/migrate";
import { ADMIN_APP_ROLE, WEB_APP_ROLE } from "../src/tenancy";
import { asRole, OWNER_ROLE, updatesUpTo, urlFor } from "./filled-database";

/** The last update before a business Renter's statements across its cars (0061). */
const LAST_UPDATE_BEFORE = "0060_lock_modes";
const DATABASE_NAME = `renter_statements_update_${process.pid}`;
const FINGERPRINT = "b".repeat(64);

interface Operator {
  id: string;
  renterId: string;
  rentalId: string;
}

/**
 * A business Renter's statement (Migration B, 0061) on a database filled at
 * 0060 the way the deployed code fills it: its documents stay as they were,
 * that code still issues them for a rental while the update is out, and a
 * statement can now belong to a Renter, only a statement, only one owner,
 * numbered in turn, and only within its own Operator.
 */
describe("the Renter statements update on a filled database", () => {
  let superuser: Client;
  let web: Client;
  let admin: Client;
  const folder = mkdtempSync(path.join(tmpdir(), "renter-statements-update-"));
  const operators: Operator[] = [];
  let fileCount = 0;
  const url = (role: string, base: string) => urlFor(role, base, DATABASE_NAME);

  async function storedPdf(operatorId: string): Promise<string> {
    fileCount += 1;
    const [file] = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into files (operator_id, purpose, storage_area, object_key, content_type, size_bytes, confirmed_at)
       values ($1, 'issued_document', 'general', $2, 'application/pdf', 2048, now()) returning id`,
      [operatorId, `${operatorId}/issued_document/filled-061-${fileCount}.pdf`],
    );
    return file!.id;
  }

  /** A document as either code issues it: for a rental, a Renter, or (refused) both or neither. */
  async function issue(
    operator: Operator,
    owner: { rentalId?: string | null; renterId?: string | null },
    kind: string,
    version: number,
  ): Promise<string> {
    const [document] = await asRole<{ id: string }>(
      web,
      operator.id,
      owner.renterId === undefined
        ? `insert into issued_documents (operator_id, rental_id, kind, version, file_id, sha256)
           values ($1, $2, $3, $4, $5, $6) returning id`
        : `insert into issued_documents (operator_id, rental_id, kind, version, file_id, sha256, renter_id)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        operator.id,
        owner.rentalId ?? null,
        kind,
        version,
        await storedPdf(operator.id),
        FINGERPRINT,
        ...(owner.renterId === undefined ? [] : [owner.renterId]),
      ],
    );
    return document!.id;
  }

  async function fillOperator(name: string, rego: string): Promise<Operator> {
    const [operator] = await asRole<{ id: string }>(
      admin,
      null,
      `insert into operators (legal_name) values ($1) returning id`,
      [name],
    );
    const operatorId = operator!.id;
    const [renter] = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into renters (operator_id, kind, full_name, abn, contact_name, email)
       values ($1, 'organisation', 'Filled Rides Pty Ltd', '51824753556', 'Dana Filled', 'dana@example.test')
       returning id`,
      [operatorId],
    );
    const [car] = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into vehicles (operator_id, rego, rego_state, make, model, year)
       values ($1, $2, 'WA', 'Kia', 'Niro', 2023) returning id`,
      [operatorId, rego],
    );
    const [rental] = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into rentals (operator_id, renter_id, vehicle_id, type, status, planned_start,
         planned_end, charge_weekday, bond_cents, settings_snapshot, settings_version)
       values ($1, $2, $3, 'fixed_term', 'draft', now() + interval '2 days', now() + interval '30 days',
         2, 0, '{}', 1)
       returning id`,
      [operatorId, renter!.id, car!.id],
    );
    return { id: operatorId, renterId: renter!.id, rentalId: rental!.id };
  }

  beforeAll(async () => {
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    await superuser.query(`CREATE DATABASE ${DATABASE_NAME} OWNER ${OWNER_ROLE}`);
    updatesUpTo(LAST_UPDATE_BEFORE, folder);
    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")), folder);
    web = new Client({ connectionString: url(WEB_APP_ROLE, inject("webRoleUrl")) });
    admin = new Client({ connectionString: url(ADMIN_APP_ROLE, inject("adminRoleUrl")) });
    await Promise.all([web.connect(), admin.connect()]);

    operators.push(await fillOperator("Filled Statements Pty Ltd", "FIL061"));
    operators.push(await fillOperator("Other Statements Pty Ltd", "OTH061"));
    const [mine] = operators;
    await issue(mine!, { rentalId: mine!.rentalId }, "contract", 1);
    await issue(mine!, { rentalId: mine!.rentalId }, "statement", 1);
    // Before the update, a document always names its rental.
    await expect(issue(mine!, { rentalId: null }, "statement", 2)).rejects.toThrow(/rental_id/);

    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")));
  });

  afterAll(async () => {
    await Promise.all([web?.end(), admin?.end()]);
    await superuser.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME} WITH (FORCE)`);
    await superuser.end();
    rmSync(folder, { recursive: true, force: true });
  });

  const documents = (operator: Operator) =>
    asRole<{ kind: string; version: number; rental_id: string | null; renter_id: string | null }>(
      web,
      operator.id,
      `select kind, version, rental_id, renter_id from issued_documents order by kind, version, renter_id nulls first`,
    );

  it("keeps the documents already issued as they were, each its rental's", async () => {
    const [mine] = operators;
    expect(await documents(mine!)).toEqual([
      { kind: "contract", version: 1, rental_id: mine!.rentalId, renter_id: null },
      { kind: "statement", version: 1, rental_id: mine!.rentalId, renter_id: null },
    ]);
  });

  it("still takes a rental's documents as the code deployed before it issues them", async () => {
    const [mine] = operators;
    await issue(mine!, { rentalId: mine!.rentalId }, "statement", 2);

    expect(await documents(mine!)).toContainEqual({
      kind: "statement",
      version: 2,
      rental_id: mine!.rentalId,
      renter_id: null,
    });
  });

  it("takes a Renter's statements, numbered in turn, beside the rental's own", async () => {
    const [mine] = operators;
    await issue(mine!, { renterId: mine!.renterId }, "statement", 1);
    await issue(mine!, { renterId: mine!.renterId }, "statement", 2);

    await expect(issue(mine!, { renterId: mine!.renterId }, "statement", 2)).rejects.toThrow(
      /issued_documents_renter_version_unique/,
    );
    const theRenters = (await documents(mine!)).filter((row) => row.renter_id !== null);
    expect(theRenters).toEqual([
      { kind: "statement", version: 1, rental_id: null, renter_id: mine!.renterId },
      { kind: "statement", version: 2, rental_id: null, renter_id: mine!.renterId },
    ]);
  });

  it("refuses a document with both owners or neither, and a Renter's anything but a statement", async () => {
    const [mine] = operators;
    await expect(
      issue(mine!, { rentalId: mine!.rentalId, renterId: mine!.renterId }, "statement", 9),
    ).rejects.toThrow(/issued_documents_one_owner/);
    await expect(issue(mine!, { rentalId: null, renterId: null }, "statement", 9)).rejects.toThrow(
      /issued_documents_one_owner/,
    );
    await expect(issue(mine!, { renterId: mine!.renterId }, "contract", 1)).rejects.toThrow(
      /issued_documents_renter_statement/,
    );
  });

  it("keeps a Renter's statement to its own Operator", async () => {
    const [mine, other] = operators;
    // Another Operator's business can't be named as the Renter.
    await expect(issue(mine!, { renterId: other!.renterId }, "statement", 1)).rejects.toThrow(
      /issued_documents_renter_fk/,
    );
    await issue(other!, { renterId: other!.renterId }, "statement", 1);

    const seenByOther = await documents(other!);
    expect(seenByOther).toEqual([
      { kind: "statement", version: 1, rental_id: null, renter_id: other!.renterId },
    ]);
    const adminSees = await asRole(admin, null, `select 1 from issued_documents`).catch(
      (error: unknown) => error,
    );
    expect(adminSees).toBeInstanceOf(Error);
  });

  it("never lets a Renter's statement be changed or removed", async () => {
    const [mine] = operators;
    await expect(
      asRole(
        web,
        mine!.id,
        `update issued_documents set version = version + 10 where renter_id = $1`,
        [mine!.renterId],
      ),
    ).rejects.toThrow();
    await expect(
      asRole(web, mine!.id, `delete from issued_documents where renter_id = $1`, [mine!.renterId]),
    ).rejects.toThrow();
  });
});
