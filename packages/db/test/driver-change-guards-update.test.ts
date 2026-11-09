import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runMigrations } from "../src/migrate";
import { ADMIN_APP_ROLE, WEB_APP_ROLE } from "../src/tenancy";
import { asRole, OWNER_ROLE, updatesUpTo, urlFor } from "./filled-database";

/** The last update before the driver change guards (0058): the database as the slice 4 code has it. */
const LAST_UPDATE_BEFORE = "0057_driver_changes";
const DATABASE_NAME = `driver_change_guards_update_${process.pid}`;
const REMOVED = "Removed";

type Statement = [query: string, values?: unknown[]];
interface Change {
  changeId: string;
  returnId: string;
  handoverId: string;
}

/**
 * The slice 4 review's update (0058) on a database filled at 0057 as the
 * code deployed with it fills it: a business's car out after a finished
 * driver change, and, eight years back, a business's rental with a finished
 * driver change and a person's with a cancelled swap. The deployed code's
 * driver change still finishes; finishing one any other way, or bringing the
 * car back while one is under way, is refused; retiring every party clears
 * the reasons typed for those changes and swaps (APP 11.2), and nothing else
 * on a finished one ever changes.
 */
describe("the driver change guards update on a filled database", () => {
  let superuser: Client;
  let web: Client;
  let owner: Client;
  const folder = mkdtempSync(path.join(tmpdir(), "driver-change-guards-update-"));
  const filled: Record<string, string> = {};
  const url = (role: string, base: string) => urlFor(role, base, DATABASE_NAME);
  /** The test's own database at an address's role (the superuser's, to date records back). */
  const databaseUrl = (base: string) => {
    const address = new URL(base);
    address.pathname = `/${DATABASE_NAME}`;
    return address.toString();
  };

  /** Several statements in one transaction as `client`, in the Operator's tenant context. */
  async function inOneTransaction(statements: readonly Statement[], client = web) {
    await client.query("begin");
    try {
      await client.query("select set_config('app.operator_id', $1, true)", [filled.operatorId]);
      const results = [];
      for (const [query, values] of statements) {
        results.push((await client.query(query, values ?? [])).rows);
      }
      await client.query("commit");
      return results;
    } catch (error) {
      await client.query("rollback");
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

  async function addBusiness(legalName: string, driverIds: readonly string[]): Promise<string> {
    const [business] = await asWeb<{ id: string }>(
      `insert into renters (operator_id, kind, full_name, email, contact_name)
       values ($1, 'organisation', $2, 'dana@example.test', 'Dana Wells') returning id`,
      [filled.operatorId, legalName],
    );
    for (const driverId of driverIds) {
      await asWeb(
        `insert into organisation_drivers (operator_id, organisation_id, driver_id, added_by_user_id)
         values ($1, $2, $3, $4)`,
        [filled.operatorId, business!.id, driverId, filled.userId],
      );
    }
    return business!.id;
  }

  async function addCar(rego: string): Promise<string> {
    const [car] = await asWeb<{ id: string }>(
      `insert into vehicles (operator_id, rego, rego_state, make, model, year)
       values ($1, $2, 'WA', 'Kia', 'Niro', 2023) returning id`,
      [filled.operatorId, rego],
    );
    return car!.id;
  }

  async function addChecklist(
    rentalId: string,
    vehicleId: string,
    kind: "handover" | "return",
    flag = "",
  ): Promise<string> {
    const [checklist] = await asWeb<{ id: string }>(
      `insert into inspections (operator_id, rental_id, vehicle_id, kind, photo_names, started_by_user_id${flag ? `, ${flag}` : ""})
       values ($1, $2, $3, $4, '{Front}', $5${flag ? ", true" : ""}) returning id`,
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

  /** A driver change under way, with its two checklists, as the deployed code starts one. */
  async function startChange(
    car: { rentalId: string; vehicleId: string },
    fromDriverId: string,
    toDriverId: string,
    reason = "Night shifts for Sam Lee",
  ): Promise<Change> {
    const returnId = await addChecklist(
      car.rentalId,
      car.vehicleId,
      "return",
      "is_for_driver_change",
    );
    const handoverId = await addChecklist(
      car.rentalId,
      car.vehicleId,
      "handover",
      "is_for_driver_change",
    );
    const [change] = await asWeb<{ id: string }>(
      `insert into rental_driver_changes (operator_id, rental_id, from_driver_id, to_driver_id, reason,
         return_inspection_id, handover_inspection_id, started_by_user_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [
        filled.operatorId,
        car.rentalId,
        fromDriverId,
        toDriverId,
        reason,
        returnId,
        handoverId,
        filled.userId,
      ],
    );
    return { changeId: change!.id, returnId, handoverId };
  }

  const completeChecklists: (change: Change, at: Date) => Statement = (change, at) => [
    `update inspections set status = 'completed', completed_at = $3, odometer_km = 1200,
       fuel_level = 'full', keys_count = 1, acceptance_text = 'Accepted' where id in ($1, $2)`,
    [change.returnId, change.handoverId, at],
  ];
  const movePossession = (
    car: { rentalId: string; vehicleId: string; renterId: string },
    change: Change,
    toDriverId: string,
    at: Date,
  ): Statement[] => [
    [
      `update possessions set ended_at = $2, return_inspection_id = $3
       where rental_id = $1 and ended_at is null`,
      [car.rentalId, at, change.returnId],
    ],
    [`update rentals set driver_id = $2 where id = $1`, [car.rentalId, toDriverId]],
    [
      `insert into possessions (operator_id, rental_id, vehicle_id, renter_id, driver_id, started_at,
         handover_inspection_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        filled.operatorId,
        car.rentalId,
        car.vehicleId,
        car.renterId,
        toDriverId,
        at,
        change.handoverId,
      ],
    ],
  ];
  const markCompleted = (change: Change, at: Date): Statement => [
    `update rental_driver_changes set status = 'completed', changed_at = $2 where id = $1`,
    [change.changeId, at],
  ];

  /** The deployed code's finishing transaction (complete-driver-change.ts): checklists, possession, change. */
  const finishAsDeployed = (
    car: { rentalId: string; vehicleId: string; renterId: string },
    change: Change,
    toDriverId: string,
    at = new Date(),
  ) =>
    inOneTransaction([
      completeChecklists(change, at),
      ...movePossession(car, change, toDriverId, at),
      markCompleted(change, at),
    ]);

  const cancelChange = (change: Change) =>
    inOneTransaction([
      [
        `update inspections set status = 'cancelled', cancelled_at = now() where id in ($1, $2)`,
        [change.returnId, change.handoverId],
      ],
      [
        `update rental_driver_changes set status = 'cancelled', cancelled_at = now() where id = $1`,
        [change.changeId],
      ],
    ]);

  /** The car brought back, as the deployed code's return does it. */
  const bringBack = (rentalId: string) =>
    inOneTransaction([
      [
        `update possessions set ended_at = now() where rental_id = $1 and ended_at is null`,
        [rentalId],
      ],
      [`update rentals set status = 'returned', returned_at = now() where id = $1`, [rentalId]],
    ]);

  /** Everything of a party and their rental dated eight years back, as no app role can. */
  async function dateBack(rentalId: string, renterIds: readonly string[]) {
    const superuser = new Client({ connectionString: databaseUrl(inject("superuserUrl")) });
    await superuser.connect();
    await superuser.query("begin");
    await superuser.query("set local session_replication_role = replica");
    await superuser.query(
      `update rentals set created_at = now() - interval '8 years',
         handed_over_at = now() - interval '8 years 7 days', returned_at = now() - interval '8 years'
       where id = $1`,
      [rentalId],
    );
    await superuser.query(
      `update possessions set started_at = started_at - interval '8 years',
         ended_at = ended_at - interval '8 years' where rental_id = $1`,
      [rentalId],
    );
    await superuser.query(
      `update organisation_drivers set added_at = now() - interval '8 years 7 days',
         removed_at = now() - interval '8 years' where organisation_id = any($1)`,
      [renterIds],
    );
    await superuser.query(
      `update renters set created_at = now() - interval '8 years 7 days' where id = any($1)`,
      [renterIds],
    );
    await superuser.query("commit");
    await superuser.end();
  }

  beforeAll(async () => {
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    await superuser.query(`CREATE DATABASE ${DATABASE_NAME} OWNER ${OWNER_ROLE}`);
    updatesUpTo(LAST_UPDATE_BEFORE, folder);
    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")), folder);
    web = new Client({ connectionString: url(WEB_APP_ROLE, inject("webRoleUrl")) });
    owner = new Client({ connectionString: url(OWNER_ROLE, inject("ownerUrl")) });
    const admin = new Client({ connectionString: url(ADMIN_APP_ROLE, inject("adminRoleUrl")) });
    await Promise.all([web.connect(), owner.connect(), admin.connect()]);

    const [operator] = await asRole<{ id: string }>(
      admin,
      null,
      `insert into operators (legal_name) values ('Filled Guards Pty Ltd') returning id`,
    );
    filled.operatorId = operator!.id;
    const [user] = await asRole<{ id: string }>(
      admin,
      null,
      `insert into users (operator_id, email, full_name) values ($1, $2, 'Filled User') returning id`,
      [filled.operatorId, `filled-guards-${process.pid}@example.test`],
    );
    filled.userId = user!.id;
    await admin.end();

    // Today: a business's car out with Mia, after a driver change from Sam.
    filled.samId = await addPerson("Sam Lee");
    filled.miaId = await addPerson("Mia Thompson");
    filled.kimId = await addPerson("Kim Other");
    filled.businessId = await addBusiness("Acme Rideshare Pty Ltd", [
      filled.samId,
      filled.miaId,
      filled.kimId,
    ]);
    filled.vehicleId = await addCar("FIL581");
    filled.rentalId = await carOut(filled.businessId, filled.vehicleId, filled.samId);
    const today = current();
    await finishAsDeployed(
      today,
      await startChange(today, filled.samId, filled.miaId),
      filled.miaId,
    );

    // Eight years back: a business's rental whose driver changed, and a person's cancelled swap.
    filled.danId = await addPerson("Dan Old");
    filled.eveId = await addPerson("Eve Old");
    filled.oldBusinessId = await addBusiness("Old Rides Pty Ltd", [filled.danId, filled.eveId]);
    const oldCar = await addCar("FIL582");
    filled.oldRentalId = await carOut(filled.oldBusinessId, oldCar, filled.danId);
    const old = { rentalId: filled.oldRentalId, vehicleId: oldCar, renterId: filled.oldBusinessId };
    const oldChange = await startChange(old, filled.danId, filled.eveId, "Dan Old has left");
    filled.oldChangeId = oldChange.changeId;
    await finishAsDeployed(old, oldChange, filled.eveId);
    await bringBack(filled.oldRentalId);
    await asWeb(`update organisation_drivers set removed_at = now() where organisation_id = $1`, [
      filled.oldBusinessId,
    ]);
    await dateBack(filled.oldRentalId, [filled.oldBusinessId, filled.danId, filled.eveId]);

    filled.patId = await addPerson("Pat Person");
    const patCar = await addCar("FIL583");
    filled.patRentalId = await carOut(filled.patId, patCar);
    const swapReturnId = await addChecklist(filled.patRentalId, patCar, "return", "is_for_swap");
    const swapCar = await addCar("FIL584");
    const swapHandoverId = await addChecklist(
      filled.patRentalId,
      swapCar,
      "handover",
      "is_for_swap",
    );
    const [swap] = await asWeb<{ id: string }>(
      `insert into car_swaps (operator_id, rental_id, from_vehicle_id, to_vehicle_id, reason,
         return_inspection_id, handover_inspection_id, started_by_user_id)
       values ($1, $2, $3, $4, 'Pat Person reported a flat tyre', $5, $6, $7) returning id`,
      [
        filled.operatorId,
        filled.patRentalId,
        patCar,
        swapCar,
        swapReturnId,
        swapHandoverId,
        filled.userId,
      ],
    );
    filled.patSwapId = swap!.id;
    await inOneTransaction([
      [
        `update inspections set status = 'cancelled', cancelled_at = now() where id in ($1, $2)`,
        [swapReturnId, swapHandoverId],
      ],
      [`update car_swaps set status = 'cancelled', cancelled_at = now() where id = $1`, [swap!.id]],
    ]);
    await bringBack(filled.patRentalId);
    await dateBack(filled.patRentalId, [filled.patId]);

    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")));
  });

  afterAll(async () => {
    await Promise.all([web?.end(), owner?.end()]);
    await superuser.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME} WITH (FORCE)`);
    await superuser.end();
    rmSync(folder, { recursive: true, force: true });
  });

  function current() {
    return {
      rentalId: filled.rentalId!,
      vehicleId: filled.vehicleId!,
      renterId: filled.businessId!,
    };
  }

  const driverOf = async (rentalId: string) =>
    (
      await asWeb<{ driverId: string }>(
        `select driver_id as "driverId" from rentals where id = $1`,
        [rentalId],
      )
    )[0]?.driverId;

  const reasonsOf = async (table: "car_swaps" | "rental_driver_changes", id: string) =>
    (
      await asRole<{ reason: string }>(
        owner,
        filled.operatorId!,
        `select reason from ${table} where id = $1`,
        [id],
      )
    )[0]?.reason;

  it("still finishes a driver change as the deployed code does, and keeps the finished one as it was", async () => {
    const change = await startChange(current(), filled.miaId!, filled.kimId!);
    await finishAsDeployed(current(), change, filled.kimId!);
    expect(await driverOf(filled.rentalId!)).toBe(filled.kimId);
    await expect(
      asWeb(`update rental_driver_changes set updated_at = now() where id = $1`, [change.changeId]),
    ).rejects.toThrow(/completed driver change cannot change/);
  });

  it("refuses a driver change marked finished without the car changing hands", async () => {
    const change = await startChange(current(), filled.kimId!, filled.miaId!);
    const at = new Date();
    await expect(
      inOneTransaction([completeChecklists(change, at), markCompleted(change, at)]),
    ).rejects.toThrow(/completed only with the car signed for by the new driver/);
    // Its checklists finished but the time with the car not moving at that moment: refused too.
    await expect(
      inOneTransaction([
        completeChecklists(change, at),
        ...movePossession(current(), change, filled.miaId!, at),
        markCompleted(change, new Date(at.getTime() + 1000)),
      ]),
    ).rejects.toThrow(/completed only with the car signed for by the new driver/);
    expect(await driverOf(filled.rentalId!)).toBe(filled.kimId);
    await cancelChange(change);
  });

  it("refuses the car changing hands unless its driver change is finished in the same transaction", async () => {
    const change = await startChange(current(), filled.kimId!, filled.miaId!);
    const at = new Date();
    await expect(
      inOneTransaction([
        completeChecklists(change, at),
        ...movePossession(current(), change, filled.miaId!, at),
      ]),
    ).rejects.toThrow(/only with its driver change completed/);
    expect(await driverOf(filled.rentalId!)).toBe(filled.kimId);
    await cancelChange(change);
  });

  it("refuses bringing the car back while a driver change is under way", async () => {
    const change = await startChange(current(), filled.kimId!, filled.miaId!);
    await expect(bringBack(filled.rentalId!)).rejects.toThrow(
      /can't come back while a driver change is under way/,
    );
    await cancelChange(change);
    const [rental] = await asWeb<{ status: string }>(`select status from rentals where id = $1`, [
      filled.rentalId,
    ]);
    expect(rental?.status).toBe("active");
  });

  it("clears the reasons of a retired party's driver changes and swaps, and nothing else", async () => {
    const retire = (renterId: string) =>
      asWeb<{ retired: boolean }>("select app.retire_renter($1) as retired", [renterId]);
    // A rental's records go only with the last of its parties.
    expect(await retire(filled.danId!)).toEqual([{ retired: true }]);
    expect(await reasonsOf("rental_driver_changes", filled.oldChangeId!)).toBe("Dan Old has left");
    expect(await retire(filled.eveId!)).toEqual([{ retired: true }]);
    expect(await retire(filled.oldBusinessId!)).toEqual([{ retired: true }]);
    expect(await retire(filled.patId!)).toEqual([{ retired: true }]);

    expect(await reasonsOf("rental_driver_changes", filled.oldChangeId!)).toBe(REMOVED);
    expect(await reasonsOf("car_swaps", filled.patSwapId!)).toBe(REMOVED);
    const [today] = await asWeb<{ reasons: string[] }>(
      `select array_agg(reason order by created_at) as reasons from rental_driver_changes where rental_id = $1`,
      [filled.rentalId],
    );
    expect(today?.reasons).not.toContain(REMOVED);
  });

  it("refuses any other change to a finished change or swap, even by the owner", async () => {
    const asOwner = (statement: Statement) => inOneTransaction([statement], owner);
    await expect(
      asOwner([
        `update rental_driver_changes set reason = 'Something else' where id = $1`,
        [filled.oldChangeId],
      ]),
    ).rejects.toThrow(/completed driver change cannot change/);
    await expect(
      asOwner([
        `update rental_driver_changes set reason = 'Removed', changed_at = now() where id = $1`,
        [filled.oldChangeId],
      ]),
    ).rejects.toThrow(/completed driver change cannot change/);
    await expect(
      asOwner([`update car_swaps set cancelled_at = now() where id = $1`, [filled.patSwapId]]),
    ).rejects.toThrow(/cancelled car swap cannot change/);
    // The web app can't clear a reason itself: it has no right to that column.
    await expect(
      asWeb(`update car_swaps set reason = 'Removed' where id = $1`, [filled.patSwapId]),
    ).rejects.toThrow(/permission denied/);
  });
});
