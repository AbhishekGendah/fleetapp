import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";

import { MIGRATIONS_FOLDER, runMigrations } from "../src/migrate";
import { ADMIN_APP_ROLE, WEB_APP_ROLE } from "../src/tenancy";

/** The last update before business Renters (0052): the database as main had it. */
const LAST_UPDATE_BEFORE = "0051_car_model_fixes";
const DATABASE_NAME = `business_renters_update_${process.pid}`;
const OWNER_ROLE = "fleetapp_test_owner";

const journalSchema = z.looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) });

/** A copy of the repo's updates up to and including `lastTag`, as an older checkout has them. */
function updatesUpTo(lastTag: string, folder: string): void {
  const journalPath = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");
  const journal = journalSchema.parse(JSON.parse(readFileSync(journalPath, "utf8")));
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
  const entries = journal.entries.slice(0, last + 1);
  mkdirSync(path.join(folder, "meta"), { recursive: true });
  for (const entry of entries) {
    copyFileSync(
      path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
      path.join(folder, `${entry.tag}.sql`),
    );
  }
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
}

function urlFor(role: string, base: string): string {
  const url = new URL(base);
  url.username = role;
  url.pathname = `/${DATABASE_NAME}`;
  return url.toString();
}

/** One statement as a role, in the given Operator's tenant context. */
async function asRole<Row extends Record<string, unknown>>(
  client: Client,
  operatorId: string | null,
  query: string,
  values: unknown[] = [],
): Promise<Row[]> {
  await client.query("begin");
  try {
    if (operatorId) {
      await client.query("select set_config('app.operator_id', $1, true)", [operatorId]);
    }
    const result = await client.query<Row>(query, values);
    await client.query("commit");
    return result.rows;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

/**
 * Migration A of business Renters (0052, 0053) on a database filled as the
 * code already deployed fills it, then that code's own inserts, which name no
 * driver, still working (progress.md "Open items": updates run on a filled
 * database and must work with the code already deployed).
 */
describe("the business Renters update on a filled database", () => {
  let superuser: Client;
  let owner: Client;
  let web: Client;
  let admin: Client;
  const folder = mkdtempSync(path.join(tmpdir(), "business-renters-update-"));
  const filled: Record<string, string> = {};

  /** An Operator's booking, handed over, as the deployed code does it: no driver anywhere. */
  async function handOverOldStyle(operatorId: string, renterId: string, vehicleId: string) {
    const [rental] = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into rentals (operator_id, renter_id, vehicle_id, type, status, planned_start,
         planned_end, charge_weekday, bond_cents, settings_snapshot, settings_version)
       values ($1, $2, $3, 'fixed_term', 'booked', now() - interval '2 days', now() + interval '26 days',
         2, 50000, '{}', 1)
       returning id`,
      [operatorId, renterId, vehicleId],
    );
    const [inspection] = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into inspections (operator_id, rental_id, vehicle_id, kind, photo_names, started_by_user_id)
       values ($1, $2, $3, 'handover', '{Front}', $4) returning id`,
      [operatorId, rental!.id, vehicleId, filled.userId],
    );
    await asRole(
      web,
      operatorId,
      `update rentals set status = 'active', handed_over_at = now() - interval '1 day' where id = $1`,
      [rental!.id],
    );
    const [possession] = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into possessions (operator_id, rental_id, vehicle_id, renter_id, started_at, handover_inspection_id)
       values ($1, $2, $3, $4, now() - interval '1 day', $5) returning id`,
      [operatorId, rental!.id, vehicleId, renterId, inspection!.id],
    );
    return { rentalId: rental!.id, possessionId: possession!.id };
  }

  beforeAll(async () => {
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    await superuser.query(`CREATE DATABASE ${DATABASE_NAME} OWNER ${OWNER_ROLE}`);
    updatesUpTo(LAST_UPDATE_BEFORE, folder);
    await runMigrations(urlFor(OWNER_ROLE, inject("ownerUrl")), folder);

    owner = new Client({ connectionString: urlFor(OWNER_ROLE, inject("ownerUrl")) });
    web = new Client({ connectionString: urlFor(WEB_APP_ROLE, inject("webRoleUrl")) });
    admin = new Client({ connectionString: urlFor(ADMIN_APP_ROLE, inject("adminRoleUrl")) });
    await Promise.all([owner.connect(), web.connect(), admin.connect()]);

    const [operator] = await asRole<{ id: string }>(
      admin,
      null,
      `insert into operators (legal_name) values ('Filled Rentals Pty Ltd') returning id`,
    );
    const operatorId = operator!.id;
    const [user] = await asRole<{ id: string }>(
      admin,
      null,
      `insert into users (operator_id, email, full_name) values ($1, $2, 'Filled User') returning id`,
      [operatorId, `filled-${process.pid}@example.test`],
    );
    filled.operatorId = operatorId;
    filled.userId = user!.id;
    const [renter] = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into renters (operator_id, full_name, email, date_of_birth, licence_issued_in,
         licence_number, licence_class, licence_type, licence_expires_on)
       values ($1, 'Sam Filled', 'sam@example.test', '1990-01-01', 'WA', 'F1234567', 'C', 'full', '2030-01-01')
       returning id`,
      [operatorId],
    );
    filled.renterId = renter!.id;
    const cars = await asRole<{ id: string }>(
      web,
      operatorId,
      `insert into vehicles (operator_id, rego, rego_state, make, model, year)
       values ($1, 'FIL001', 'WA', 'Kia', 'Niro', 2023), ($1, 'FIL002', 'WA', 'Kia', 'Niro', 2023)
       returning id`,
      [operatorId],
    );
    filled.carId = cars[0]!.id;
    filled.secondCarId = cars[1]!.id;
    // One car back, its possession ended (kept as it is), and one still out.
    const back = await handOverOldStyle(operatorId, renter!.id, cars[0]!.id);
    await asRole(web, operatorId, `update possessions set ended_at = now() where id = $1`, [
      back.possessionId,
    ]);
    await asRole(
      web,
      operatorId,
      `update rentals set status = 'returned', returned_at = now() where id = $1`,
      [back.rentalId],
    );
    filled.returnedRentalId = back.rentalId;

    await runMigrations(urlFor(OWNER_ROLE, inject("ownerUrl")));
  });

  afterAll(async () => {
    await Promise.all([owner?.end(), web?.end(), admin?.end()]);
    await superuser.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME} WITH (FORCE)`);
    await superuser.end();
    rmSync(folder, { recursive: true, force: true });
  });

  it("makes every existing Renter a person, and names each rental's and possession's driver", async () => {
    const operatorId = filled.operatorId!;
    const renters = await asRole<{ kind: string }>(web, operatorId, `select kind from renters`);
    const rentals = await asRole<{ renter_id: string; driver_id: string }>(
      web,
      operatorId,
      `select renter_id, driver_id from rentals`,
    );
    const possessions = await asRole<{ renter_id: string; driver_id: string; ended_at: Date }>(
      web,
      operatorId,
      `select renter_id, driver_id, ended_at from possessions`,
    );

    expect(renters).toEqual([{ kind: "person" }]);
    expect(rentals.length).toBeGreaterThan(0);
    expect(rentals.every((row) => row.driver_id === row.renter_id)).toBe(true);
    expect(possessions.some((row) => row.ended_at !== null)).toBe(true);
    expect(possessions.every((row) => row.driver_id === row.renter_id)).toBe(true);
  });

  it("still takes the deployed code's bookings and handovers, which name no driver", async () => {
    const operatorId = filled.operatorId!;
    const { rentalId, possessionId } = await handOverOldStyle(
      operatorId,
      filled.renterId!,
      filled.secondCarId!,
    );

    const [rental] = await asRole<{ driver_id: string }>(
      web,
      operatorId,
      `select driver_id from rentals where id = $1`,
      [rentalId],
    );
    const [possession] = await asRole<{ driver_id: string }>(
      web,
      operatorId,
      `select driver_id from possessions where id = $1`,
      [possessionId],
    );
    expect(rental?.driver_id).toBe(filled.renterId);
    expect(possession?.driver_id).toBe(filled.renterId);
  });

  it("leaves row-level security forced, and an ended possession kept, after the backfill", async () => {
    const filledDatabase = new Client({
      connectionString: urlFor("postgres", inject("superuserUrl")),
    });
    await filledDatabase.connect();
    try {
      const forced = await filledDatabase.query<{ relname: string; relforcerowsecurity: boolean }>(
        `select relname, relforcerowsecurity from pg_class where relname in ('rentals', 'possessions')`,
      );
      expect(forced.rows.every((row) => row.relforcerowsecurity)).toBe(true);
      expect(forced.rows).toHaveLength(2);
      const triggers = await filledDatabase.query<{ tgenabled: string }>(
        `select tgenabled from pg_trigger where tgname = 'possessions_kept'`,
      );
      expect(triggers.rows).toEqual([{ tgenabled: "O" }]);
    } finally {
      await filledDatabase.end();
    }
  });
});
