import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runMigrations } from "../src/migrate";
import { ADMIN_APP_ROLE, WEB_APP_ROLE } from "../src/tenancy";
import { asRole, OWNER_ROLE, updatesUpTo, urlFor } from "./filled-database";
import { driverChangeFillers, type Statement } from "./filled-driver-changes";

/** The last update before the driver change guards (0058): the database as the slice 4 code has it. */
const LAST_UPDATE_BEFORE = "0057_driver_changes";
const DATABASE_NAME = `driver_change_guards_update_${process.pid}`;
const REMOVED = "Removed";

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
  const {
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
  } = driverChangeFillers({ databaseName: DATABASE_NAME, web: () => web, filled });

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
