import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runMigrations } from "../src/migrate";
import { ADMIN_APP_ROLE, WEB_APP_ROLE } from "../src/tenancy";
import { asRole, OWNER_ROLE, updatesUpTo, urlFor } from "./filled-database";

/** The last update before driver changes (0057): the database as main had it. */
const LAST_UPDATE_BEFORE = "0056_driver_document_copies";
const DATABASE_NAME = `driver_changes_update_${process.pid}`;
const SECOND_MS = 1000;

type Statement = [query: string, values?: unknown[]];

/**
 * Migration C of business Renters (0057) on a database filled at 0056 as the
 * deployed code fills it: a business's car out with its driver, a person's
 * car out, a business's booking. The code deployed before it keeps working
 * (its checklists, swaps and the naming of a booking's driver), and a car
 * that is out changes driver only through a driver change under way, one
 * possession ending as the next starts, never overlapping.
 */
describe("the driver change update on a filled database", () => {
  let superuser: Client;
  let web: Client;
  let admin: Client;
  const folder = mkdtempSync(path.join(tmpdir(), "driver-changes-update-"));
  const filled: Record<string, string> = {};
  const url = (role: string, base: string) => urlFor(role, base, DATABASE_NAME);

  /** Several statements in one transaction as the web app, in the Operator's tenant context. */
  async function inOneTransaction(
    statements: readonly Statement[],
    operatorId = filled.operatorId,
  ) {
    await web.query("begin");
    try {
      await web.query("select set_config('app.operator_id', $1, true)", [operatorId]);
      const results = [];
      for (const [query, values] of statements) {
        results.push((await web.query(query, values ?? [])).rows);
      }
      await web.query("commit");
      return results;
    } catch (error) {
      await web.query("rollback");
      throw error;
    }
  }

  const asWeb = <Row extends Record<string, unknown>>(query: string, values: unknown[] = []) =>
    asRole<Row>(web, filled.operatorId!, query, values);

  async function addPerson(name: string): Promise<string> {
    const [person] = await asWeb<{ id: string }>(
      `insert into renters (operator_id, full_name, email, date_of_birth, licence_issued_in,
         licence_number, licence_class, licence_type, licence_expires_on)
       values ($1, $2, $3, '1990-01-01', 'WA', $4, 'C', 'full', '2030-01-01') returning id`,
      [
        filled.operatorId,
        name,
        `${name.split(" ")[0]!.toLowerCase()}@example.test`,
        `F${Math.floor(Math.random() * 1e7)}`,
      ],
    );
    return person!.id;
  }

  async function addCar(rego: string): Promise<string> {
    const [car] = await asWeb<{ id: string }>(
      `insert into vehicles (operator_id, rego, rego_state, make, model, year)
       values ($1, $2, 'WA', 'Kia', 'Niro', 2023) returning id`,
      [filled.operatorId, rego],
    );
    return car!.id;
  }

  /** A checklist of the rental's car, as the code adds one. */
  async function addChecklist(
    rentalId: string,
    vehicleId: string,
    kind: "handover" | "return",
    flags = "",
  ): Promise<string> {
    const [checklist] = await asWeb<{ id: string }>(
      `insert into inspections (operator_id, rental_id, vehicle_id, kind, photo_names, started_by_user_id${flags ? `, ${flags}` : ""})
       values ($1, $2, $3, $4, '{Front}', $5${flags ? ", true" : ""}) returning id`,
      [filled.operatorId, rentalId, vehicleId, kind, filled.userId],
    );
    return checklist!.id;
  }

  /** A rental handed over the way the deployed code does it: its driver named, a possession open. */
  async function carOut(renterId: string, vehicleId: string, driverId: string | null = null) {
    const [rental] = await asWeb<{ id: string }>(
      `insert into rentals (operator_id, renter_id, driver_id, vehicle_id, type, status, planned_start,
         planned_end, charge_weekday, bond_cents, settings_snapshot, settings_version)
       values ($1, $2, $3, $4, 'fixed_term', 'booked', now() - interval '2 days',
         now() + interval '26 days', 2, 50000, '{}', 1)
       returning id`,
      [filled.operatorId, renterId, driverId, vehicleId],
    );
    const handoverId = await addChecklist(rental!.id, vehicleId, "handover");
    await inOneTransaction([
      [
        `update rentals set status = 'active', handed_over_at = now() - interval '1 day' where id = $1`,
        [rental!.id],
      ],
      [
        `insert into possessions (operator_id, rental_id, vehicle_id, renter_id, started_at, handover_inspection_id)
         values ($1, $2, $3, $4, now() - interval '1 day', $5)`,
        [filled.operatorId, rental!.id, vehicleId, renterId, handoverId],
      ],
      [
        `update inspections set status = 'completed', completed_at = now(), odometer_km = 1000,
           fuel_level = 'full', keys_count = 1, acceptance_text = 'Accepted' where id = $1`,
        [handoverId],
      ],
    ]);
    return rental!.id;
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

    const operators = await asRole<{ id: string }>(
      admin,
      null,
      `insert into operators (legal_name) values ('Filled Drivers Pty Ltd'), ('Other Filled Pty Ltd')
       returning id`,
    );
    filled.operatorId = operators[0]!.id;
    filled.otherOperatorId = operators[1]!.id;
    const [user] = await asRole<{ id: string }>(
      admin,
      null,
      `insert into users (operator_id, email, full_name) values ($1, $2, 'Filled User') returning id`,
      [filled.operatorId, `filled-drivers-${process.pid}@example.test`],
    );
    filled.userId = user!.id;
    const [business] = await asWeb<{ id: string }>(
      `insert into renters (operator_id, kind, full_name, email, contact_name)
       values ($1, 'organisation', 'Acme Rideshare Pty Ltd', 'dana@example.test', 'Dana Wells')
       returning id`,
      [filled.operatorId],
    );
    filled.businessId = business!.id;
    filled.samId = await addPerson("Sam Lee");
    filled.miaId = await addPerson("Mia Thompson");
    filled.kimId = await addPerson("Kim Other");
    filled.personId = await addPerson("Pat Person");
    for (const driverId of [filled.samId, filled.miaId, filled.kimId]) {
      await asWeb(
        `insert into organisation_drivers (operator_id, organisation_id, driver_id, added_by_user_id)
         values ($1, $2, $3, $4)`,
        [filled.operatorId, filled.businessId, driverId, filled.userId],
      );
    }
    filled.businessCarId = await addCar("FIL571");
    filled.personCarId = await addCar("FIL572");
    filled.bookedCarId = await addCar("FIL573");
    filled.businessRentalId = await carOut(filled.businessId, filled.businessCarId, filled.samId);
    filled.personRentalId = await carOut(filled.personId, filled.personCarId);
    const [booked] = await asWeb<{ id: string }>(
      `insert into rentals (operator_id, renter_id, driver_id, vehicle_id, type, status, planned_start,
         planned_end, charge_weekday, bond_cents, settings_snapshot, settings_version)
       values ($1, $2, $3, $4, 'fixed_term', 'booked', now() + interval '2 days',
         now() + interval '30 days', 2, 50000, '{}', 1)
       returning id`,
      [filled.operatorId, filled.businessId, filled.samId, filled.bookedCarId],
    );
    filled.bookedRentalId = booked!.id;

    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")));
  });

  afterAll(async () => {
    await Promise.all([web?.end(), admin?.end()]);
    await superuser.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME} WITH (FORCE)`);
    await superuser.end();
    rmSync(folder, { recursive: true, force: true });
  });

  /** A driver change of the business's car under way, with its two checklists. */
  async function startChange(toDriverId = filled.miaId!, fromDriverId = filled.samId!) {
    const returnId = await addChecklist(
      filled.businessRentalId!,
      filled.businessCarId!,
      "return",
      "is_for_driver_change",
    );
    const handoverId = await addChecklist(
      filled.businessRentalId!,
      filled.businessCarId!,
      "handover",
      "is_for_driver_change",
    );
    const [change] = await asWeb<{ id: string }>(
      `insert into rental_driver_changes (operator_id, rental_id, from_driver_id, to_driver_id, reason,
         return_inspection_id, handover_inspection_id, started_by_user_id)
       values ($1, $2, $3, $4, 'Night shifts', $5, $6, $7) returning id`,
      [
        filled.operatorId,
        filled.businessRentalId,
        fromDriverId,
        toDriverId,
        returnId,
        handoverId,
        filled.userId,
      ],
    );
    return { changeId: change!.id, returnId, handoverId };
  }

  async function cancelChange(change: { changeId: string; returnId: string; handoverId: string }) {
    await inOneTransaction([
      [
        `update inspections set status = 'cancelled', cancelled_at = now() where id in ($1, $2)`,
        [change.returnId, change.handoverId],
      ],
      [
        `update rental_driver_changes set status = 'cancelled', cancelled_at = now() where id = $1`,
        [change.changeId],
      ],
    ]);
  }

  /**
   * The driver change's own transaction: its checklists finish, one
   * possession ends, the driver changes, the next starts, and the change is
   * completed (each needed together since 0058).
   */
  function changeHands(
    change: { changeId: string; handoverId: string },
    at: Date,
    toDriverId = filled.miaId!,
  ) {
    return inOneTransaction([
      [
        `update inspections set status = 'completed', completed_at = $3, odometer_km = 1200,
           fuel_level = 'full', keys_count = 1, acceptance_text = 'Accepted'
         where id = $1 or id = (select return_inspection_id from rental_driver_changes where id = $2)`,
        [change.handoverId, change.changeId, at],
      ],
      [
        `update possessions set ended_at = $2, return_inspection_id = (
           select return_inspection_id from rental_driver_changes where id = $3)
         where rental_id = $1 and ended_at is null`,
        [filled.businessRentalId, at, change.changeId],
      ],
      [`update rentals set driver_id = $2 where id = $1`, [filled.businessRentalId, toDriverId]],
      [
        `insert into possessions (operator_id, rental_id, vehicle_id, renter_id, driver_id, started_at,
           handover_inspection_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          filled.operatorId,
          filled.businessRentalId,
          filled.businessCarId,
          filled.businessId,
          toDriverId,
          at,
          change.handoverId,
        ],
      ],
      [
        `update rental_driver_changes set status = 'completed', changed_at = $2 where id = $1`,
        [change.changeId, at],
      ],
    ]);
  }

  it("keeps every checklist as it was, and the deployed code's own checklists still go in", async () => {
    const flagged = await asWeb<{ count: number }>(
      `select count(*)::int as count from inspections where is_for_driver_change`,
    );
    expect(flagged[0]?.count).toBe(0);
    // As the deployed code starts a return: no word of a driver change.
    const returnId = await addChecklist(filled.personRentalId!, filled.personCarId!, "return");
    const [row] = await asWeb<{ isForDriverChange: boolean }>(
      `select is_for_driver_change as "isForDriverChange" from inspections where id = $1`,
      [returnId],
    );
    expect(row?.isForDriverChange).toBe(false);
    await asWeb(`update inspections set status = 'cancelled', cancelled_at = now() where id = $1`, [
      returnId,
    ]);
    await expect(
      addChecklist(
        filled.personRentalId!,
        filled.personCarId!,
        "return",
        "is_for_swap, is_for_driver_change",
      ),
    ).rejects.toThrow();
  });

  it("still lets the deployed code name a booking's driver, and start a swap with no change under way", async () => {
    await asWeb(`update rentals set driver_id = $2 where id = $1`, [
      filled.bookedRentalId,
      filled.miaId,
    ]);
    const swapCarId = await addCar("FIL574");
    const returnId = await addChecklist(
      filled.personRentalId!,
      filled.personCarId!,
      "return",
      "is_for_swap",
    );
    const handoverId = await addChecklist(
      filled.personRentalId!,
      swapCarId,
      "handover",
      "is_for_swap",
    );
    const [swap] = await asWeb<{ id: string }>(
      `insert into car_swaps (operator_id, rental_id, from_vehicle_id, to_vehicle_id, reason,
         return_inspection_id, handover_inspection_id, started_by_user_id)
       values ($1, $2, $3, $4, 'Flat tyre', $5, $6, $7) returning id`,
      [
        filled.operatorId,
        filled.personRentalId,
        filled.personCarId,
        swapCarId,
        returnId,
        handoverId,
        filled.userId,
      ],
    );
    expect(swap?.id).toBeDefined();
    await inOneTransaction([
      [
        `update inspections set status = 'cancelled', cancelled_at = now() where id in ($1, $2)`,
        [returnId, handoverId],
      ],
      [`update car_swaps set status = 'cancelled', cancelled_at = now() where id = $1`, [swap!.id]],
    ]);
  });

  it("refuses a car that is out changing driver with no driver change under way", async () => {
    await expect(
      changeHands(
        { changeId: "00000000-0000-4000-8000-000000000000", handoverId: filled.businessRentalId! },
        new Date(),
      ),
    ).rejects.toThrow(/only through a driver change under way|violates foreign key/);
    const [rental] = await asWeb<{ driverId: string }>(
      `select driver_id as "driverId" from rentals where id = $1`,
      [filled.businessRentalId],
    );
    expect(rental?.driverId).toBe(filled.samId);
  });

  it("starts a driver change only for a business's car that is out, from the driver who has it", async () => {
    // From someone other than the driver who has the car.
    await expect(startChange(filled.samId, filled.miaId)).rejects.toThrow(
      /from the driver who has it|other_driver/,
    );
    await asWeb(
      `update inspections set status = 'cancelled', cancelled_at = now()
       where rental_id = $1 and status = 'in_progress'`,
      [filled.businessRentalId],
    );
    const [personsChange] = await Promise.allSettled([
      asWeb(
        `insert into rental_driver_changes (operator_id, rental_id, from_driver_id, to_driver_id, reason,
           return_inspection_id, handover_inspection_id, started_by_user_id)
         select $1, $2, $3, $4, 'x', i.id, i.id, $5 from inspections i where i.rental_id = $2 limit 1`,
        [filled.operatorId, filled.personRentalId, filled.personId, filled.miaId, filled.userId],
      ),
    ]);
    expect(personsChange.status).toBe("rejected");
  });

  it("keeps swaps and driver changes apart, one under way at a time", async () => {
    const change = await startChange();
    const swapCarId = await addCar("FIL575");
    await expect(
      asWeb(
        `insert into car_swaps (operator_id, rental_id, from_vehicle_id, to_vehicle_id, reason,
           return_inspection_id, handover_inspection_id, started_by_user_id)
         values ($1, $2, $3, $4, 'Flat tyre', $5, $6, $7)`,
        [
          filled.operatorId,
          filled.businessRentalId,
          filled.businessCarId,
          swapCarId,
          change.returnId,
          change.handoverId,
          filled.userId,
        ],
      ),
    ).rejects.toThrow(/while a driver change is under way/);
    await cancelChange(change);
    // A cancelled change is kept as it is, and is never deleted.
    await expect(
      asWeb(`update rental_driver_changes set updated_at = now() where id = $1`, [change.changeId]),
    ).rejects.toThrow(/cancelled driver change cannot change/);
    await expect(
      asWeb(`delete from rental_driver_changes where id = $1`, [change.changeId]),
    ).rejects.toThrow();
  });

  it("moves the car from one driver to the next at one instant, so who had it is never a guess", async () => {
    const change = await startChange();
    const at = new Date(Date.now() - 60 * SECOND_MS);

    // Only to the driver the change names, even another current driver of the business.
    await expect(changeHands(change, at, filled.kimId)).rejects.toThrow(
      /only through a driver change under way/,
    );
    await changeHands(change, at);

    const held = await asWeb<{ driverId: string; endedAt: Date | null; startedAt: Date }>(
      `select driver_id as "driverId", started_at as "startedAt", ended_at as "endedAt"
       from possessions where rental_id = $1 order by started_at`,
      [filled.businessRentalId],
    );
    expect(held.map((possession) => possession.driverId)).toEqual([filled.samId, filled.miaId]);
    expect(held[0]?.endedAt?.getTime()).toBe(at.getTime());
    expect(held[1]?.startedAt.getTime()).toBe(at.getTime());
    // A fine-style lookup: who had this car at a moment.
    const whoHad = async (moment: Date) =>
      (
        await asWeb<{ driverId: string }>(
          `select driver_id as "driverId" from possessions
           where vehicle_id = $1 and held_during @> $2::timestamptz`,
          [filled.businessCarId, moment],
        )
      ).map((row) => row.driverId);
    expect(await whoHad(new Date(at.getTime() - SECOND_MS))).toEqual([filled.samId]);
    expect(await whoHad(at)).toEqual([filled.miaId]);
    expect(await whoHad(new Date(at.getTime() + SECOND_MS))).toEqual([filled.miaId]);
    await expect(
      asWeb(`update rental_driver_changes set updated_at = now() where id = $1`, [change.changeId]),
    ).rejects.toThrow(/completed driver change cannot change/);
  });

  it("shows one Operator's driver changes to that Operator only", async () => {
    const theirs = await asRole<{ count: number }>(
      web,
      filled.otherOperatorId!,
      `select count(*)::int as count from rental_driver_changes`,
    );
    const ours = await asWeb<{ count: number }>(
      `select count(*)::int as count from rental_driver_changes`,
    );
    expect(theirs[0]?.count).toBe(0);
    expect(ours[0]?.count).toBeGreaterThan(0);
    const adminSees = await asRole(admin, null, `select 1 from rental_driver_changes`).catch(
      (error: unknown) => error,
    );
    expect(adminSees).toBeInstanceOf(Error);
  });
});
