import { Client } from "pg";
import { inject } from "vitest";

import { asRole } from "./filled-database";

/** One statement of a transaction, with its values. */
export type Statement = [query: string, values?: unknown[]];

/** A driver change as the deployed code starts one: its id and its two checklists. */
export interface Change {
  changeId: string;
  returnId: string;
  handoverId: string;
}

/**
 * What the driver change updates' tests (0058, 0059) fill their database
 * with, the way the code deployed before each update does: people,
 * businesses and cars, a car out, a driver change started, finished or
 * cancelled, the car brought back, and records dated years back. `web` is
 * the test's web app login once connected; `filled` holds the ids made
 * (the Operator's and User's first).
 */
export function driverChangeFillers(context: {
  databaseName: string;
  web: () => Client;
  filled: Record<string, string>;
}) {
  const { databaseName, filled } = context;

  /** The test's own database at an address's role (the superuser's, to date records back). */
  const databaseUrl = (base: string) => {
    const address = new URL(base);
    address.pathname = `/${databaseName}`;
    return address.toString();
  };

  /** Several statements in one transaction as `client`, in the Operator's tenant context. */
  async function inOneTransaction(statements: readonly Statement[], client = context.web()) {
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
    asRole<Row>(context.web(), filled.operatorId!, query, values);

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

  return {
    inOneTransaction,
    asWeb,
    addPerson,
    addBusiness,
    addCar,
    addChecklist,
    carOut,
    startChange,
    completeChecklists,
    movePossession,
    markCompleted,
    finishAsDeployed,
    cancelChange,
    bringBack,
    dateBack,
  };
}
