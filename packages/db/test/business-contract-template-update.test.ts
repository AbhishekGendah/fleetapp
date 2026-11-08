import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runMigrations } from "../src/migrate";
import { ADMIN_APP_ROLE, WEB_APP_ROLE } from "../src/tenancy";
import { asRole, OWNER_ROLE, updatesUpTo, urlFor } from "./filled-database";

/** The last update before the business rental contract's template kind (0055). */
const LAST_UPDATE_BEFORE = "0054_late_car_holds";
const DATABASE_NAME = `business_contract_update_${process.pid}`;
const CONTENT = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });

/**
 * Business Renters slice 3 (0055): the "Business rental contract" template
 * kind, added on a database filled at 0054 with a default rental contract,
 * which it keeps as it was; a business contract can then be a default of its
 * own, beside it.
 */
describe("the business rental contract update on a filled database", () => {
  let superuser: Client;
  let web: Client;
  let admin: Client;
  const folder = mkdtempSync(path.join(tmpdir(), "business-contract-update-"));
  const filled: Record<string, string> = {};
  const url = (role: string, base: string) => urlFor(role, base, DATABASE_NAME);

  /** A template and its first version, as the deployed code adds one in Settings → Contracts. */
  async function addTemplate(kind: string, name: string): Promise<string> {
    const [template] = await asRole<{ id: string }>(
      web,
      filled.operatorId!,
      `insert into contract_templates (operator_id, kind, name, is_default)
       values ($1, $2, $3, true) returning id`,
      [filled.operatorId, kind, name],
    );
    await asRole(
      web,
      filled.operatorId!,
      `insert into contract_template_versions (operator_id, template_id, version, content, created_by_user_id)
       values ($1, $2, 1, $3::jsonb, $4)`,
      [filled.operatorId, template!.id, CONTENT, filled.userId],
    );
    return template!.id;
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
      `insert into operators (legal_name) values ('Filled Contracts Pty Ltd') returning id`,
    );
    const [user] = await asRole<{ id: string }>(
      admin,
      null,
      `insert into users (operator_id, email, full_name) values ($1, $2, 'Filled User') returning id`,
      [operator!.id, `filled-contracts-${process.pid}@example.test`],
    );
    filled.operatorId = operator!.id;
    filled.userId = user!.id;
    filled.contractId = await addTemplate("contract", "Our rental contract");

    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")));
  });

  afterAll(async () => {
    await Promise.all([web?.end(), admin?.end()]);
    await superuser.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME} WITH (FORCE)`);
    await superuser.end();
    rmSync(folder, { recursive: true, force: true });
  });

  it("keeps the filled database's rental contract as it was, still the default", async () => {
    const templates = await asRole<{ id: string; kind: string; is_default: boolean }>(
      web,
      filled.operatorId!,
      `select id, kind, is_default from contract_templates`,
    );

    expect(templates).toEqual([{ id: filled.contractId, kind: "contract", is_default: true }]);
  });

  it("takes a business rental contract as a default of its own kind, beside the person's", async () => {
    const businessId = await addTemplate("business_contract", "Our business contract");

    const defaults = await asRole<{ id: string; kind: string }>(
      web,
      filled.operatorId!,
      `select id, kind from contract_templates where is_default order by kind`,
    );

    expect(defaults).toEqual([
      { id: filled.contractId, kind: "contract" },
      { id: businessId, kind: "business_contract" },
    ]);
  });

  it("still holds one default of each kind", async () => {
    await expect(addTemplate("business_contract", "A second default")).rejects.toThrow(
      /contract_templates_one_default_per_kind/,
    );
  });
});
