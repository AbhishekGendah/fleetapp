import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runMigrations } from "../src/migrate";
import { ADMIN_APP_ROLE, WEB_APP_ROLE } from "../src/tenancy";
import { asRole, OWNER_ROLE, updatesUpTo, urlFor } from "./filled-database";

/** The last update before a business's driver gets their own copies (0056). */
const LAST_UPDATE_BEFORE = "0055_business_contract_template";
const DATABASE_NAME = `driver_document_copies_update_${process.pid}`;
const FINGERPRINT = "a".repeat(64);

/**
 * The driver's own copies (0056): the recipient check widened on a database
 * filled at 0055 with copies already recorded, which stay as they were; the
 * code deployed before it still records its two kinds of copy, and the new
 * code its driver's copy, while anything else is still refused.
 */
describe("the driver's copies update on a filled database", () => {
  let superuser: Client;
  let web: Client;
  let admin: Client;
  const folder = mkdtempSync(path.join(tmpdir(), "driver-document-copies-update-"));
  const filled: Record<string, string> = {};
  const url = (role: string, base: string) => urlFor(role, base, DATABASE_NAME);

  /** One try at a copy, as the app records it. */
  function recordTry(recipient: string, outcome = "sent") {
    return asRole(
      web,
      filled.operatorId!,
      `insert into document_emails (operator_id, document_id, recipient, outcome)
       values ($1, $2, $3, $4)`,
      [filled.operatorId, filled.documentId, recipient, outcome],
    );
  }

  /** A booking with its signed contract issued, as the deployed code stores one. */
  async function fillIssuedDocument(): Promise<void> {
    const operatorId = filled.operatorId!;
    const [renter] = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into renters (operator_id, full_name, email) values ($1, 'Sam Filled', 'sam@example.test')
       returning id`,
      [operatorId],
    );
    const [car] = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into vehicles (operator_id, rego, rego_state, make, model, year)
       values ($1, 'FIL056', 'WA', 'Kia', 'Niro', 2023) returning id`,
      [operatorId],
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
    const [file] = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into files (operator_id, purpose, storage_area, object_key, content_type, size_bytes, confirmed_at)
       values ($1, 'issued_document', 'general', $2, 'application/pdf', 2048, now()) returning id`,
      [operatorId, `${operatorId}/issued_document/filled-056.pdf`],
    );
    const [document] = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into issued_documents (operator_id, rental_id, kind, version, file_id, sha256)
       values ($1, $2, 'contract', 1, $3, $4) returning id`,
      [operatorId, rental!.id, file!.id, FINGERPRINT],
    );
    filled.documentId = document!.id;
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

    const [operator] = await asRole<{ id: string }>(
      admin,
      null,
      `insert into operators (legal_name) values ('Filled Copies Pty Ltd') returning id`,
    );
    filled.operatorId = operator!.id;
    await fillIssuedDocument();
    await recordTry("renter");
    await recordTry("business", "no_address");
    // Before the update, a driver's copy is refused.
    await expect(recordTry("driver")).rejects.toThrow(/document_emails_recipient/);

    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")));
  });

  afterAll(async () => {
    await Promise.all([web?.end(), admin?.end()]);
    await superuser.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME} WITH (FORCE)`);
    await superuser.end();
    rmSync(folder, { recursive: true, force: true });
  });

  const tries = () =>
    asRole<{ recipient: string; outcome: string }>(
      web,
      filled.operatorId!,
      `select recipient, outcome from document_emails order by tried_at`,
    );

  it("keeps the copies already recorded as they were", async () => {
    expect(await tries()).toEqual([
      { recipient: "renter", outcome: "sent" },
      { recipient: "business", outcome: "no_address" },
    ]);
  });

  it("still takes the two kinds of copy the code deployed before it records", async () => {
    await recordTry("renter", "failed");
    await recordTry("business", "sent");

    expect(await tries()).toEqual(
      expect.arrayContaining([
        { recipient: "renter", outcome: "failed" },
        { recipient: "business", outcome: "sent" },
      ]),
    );
  });

  it("takes a driver's copy, and still refuses any other recipient", async () => {
    await recordTry("driver", "no_address");

    expect(await tries()).toContainEqual({ recipient: "driver", outcome: "no_address" });
    await expect(recordTry("contact")).rejects.toThrow(/document_emails_recipient/);
  });
});
