import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runMigrations } from "../src/migrate";
import { ADMIN_APP_ROLE, WEB_APP_ROLE } from "../src/tenancy";
import { asRole, OWNER_ROLE, updatesUpTo, urlFor } from "./filled-database";
import { driverChangeFillers, type Change, type Statement } from "./filled-driver-changes";

/** The last update before 0059: the database as the slice 4 review's code has it. */
const LAST_UPDATE_BEFORE = "0058_driver_change_guards";
const DATABASE_NAME = `driver_change_records_update_${process.pid}`;
const REMOVED = "Removed";
const HOUR_MS = 60 * 60 * 1000;

interface MarkRow extends Record<string, unknown> {
  clientKey: string | null;
  copiedFromMarkId: string | null;
}

/**
 * The slice 4 second review's update (0059) on a database filled at 0058 as
 * the code deployed with it fills it: a driver change's copied damage marks
 * keeping the mark they show in the phone's key, a phone's own key on a
 * check-in, and, eight years back, cancelled driver changes whose reasons
 * name the driver they would have handed the car to. The copies' marks move
 * to their own column and the phone's keys stay; the code deployed before
 * still copies marks for a while and is moved across as it goes; a
 * cancelled change's reason goes with the driver it named, or with the
 * rental's real parties; and a driver change is finished only at the moment
 * it is signed.
 */
describe("the driver change records update on a filled database", () => {
  let superuser: Client;
  let web: Client;
  let owner: Client;
  const folder = mkdtempSync(path.join(tmpdir(), "driver-change-records-update-"));
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
    cancelChange,
    bringBack,
    dateBack,
  } = driverChangeFillers({ databaseName: DATABASE_NAME, web: () => web, filled });

  const addMark = (inspectionId: string, description: string, clientKey: string | null) =>
    asWeb<{ id: string }>(
      `insert into inspection_damage_marks (operator_id, inspection_id, x, y, description, client_key,
         created_by_user_id)
       values ($1, $2, 400, 200, $3, $4, $5) returning id`,
      [filled.operatorId, inspectionId, description, clientKey, filled.userId],
    ).then((rows) => rows[0]!.id);

  /** A copy onto the new driver's checklist, as the code deployed with 0058 makes it: the mark shown in its key. */
  const copyAsDeployed = (change: Change, description: string, shownMarkId: string): Statement => [
    `insert into inspection_damage_marks (operator_id, inspection_id, x, y, description, client_key,
       created_by_user_id)
     values ($1, $2, 400, 200, $3, $4, $5)`,
    [filled.operatorId, change.handoverId, description, shownMarkId, filled.userId],
  ];

  /** The 0058 code's finishing transaction, its copies first (complete-driver-change.ts). */
  const finishWithCopies = (
    car: { rentalId: string; vehicleId: string; renterId: string },
    change: Change,
    toDriverId: string,
    copies: readonly Statement[],
    at = new Date(),
  ) =>
    inOneTransaction([
      ...copies,
      completeChecklists(change, at),
      ...movePossession(car, change, toDriverId, at),
      markCompleted(change, at),
    ]);

  const marksOn = (inspectionId: string) =>
    asWeb<MarkRow & { description: string }>(
      `select description, client_key as "clientKey", copied_from_mark_id as "copiedFromMarkId"
       from inspection_damage_marks where inspection_id = $1 order by description`,
      [inspectionId],
    );

  const current = () => ({
    rentalId: filled.rentalId!,
    vehicleId: filled.vehicleId!,
    renterId: filled.businessId!,
  });

  /** An old business's rental, eight years back, whose change to `proposedName` was cancelled. */
  async function oldCancelledChange(names: { driver: string; proposed: string; rego: string }) {
    const driverId = await addPerson(names.driver);
    const proposedId = await addPerson(names.proposed);
    const businessId = await addBusiness(`${names.driver} Rides Pty Ltd`, [driverId, proposedId]);
    const carId = await addCar(names.rego);
    const rentalId = await carOut(businessId, carId, driverId);
    const change = await startChange(
      { rentalId, vehicleId: carId },
      driverId,
      proposedId,
      `${names.proposed} was to take over`,
    );
    await cancelChange(change);
    await bringBack(rentalId);
    await asWeb(`update organisation_drivers set removed_at = now() where organisation_id = $1`, [
      businessId,
    ]);
    await dateBack(rentalId, [businessId, driverId, proposedId]);
    return { driverId, proposedId, businessId, changeId: change.changeId };
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
      `insert into operators (legal_name) values ('Filled Records Pty Ltd') returning id`,
    );
    filled.operatorId = operator!.id;
    const [user] = await asRole<{ id: string }>(
      admin,
      null,
      `insert into users (operator_id, email, full_name) values ($1, $2, 'Filled User') returning id`,
      [filled.operatorId, `filled-records-${process.pid}@example.test`],
    );
    filled.userId = user!.id;
    await admin.end();

    // Today: a business's car changed from Sam to Mia, a dent found at the check-in.
    filled.samId = await addPerson("Sam Lee");
    filled.miaId = await addPerson("Mia Thompson");
    filled.kimId = await addPerson("Kim Other");
    filled.businessId = await addBusiness("Acme Rideshare Pty Ltd", [
      filled.samId,
      filled.miaId,
      filled.kimId,
    ]);
    filled.vehicleId = await addCar("FIL591");
    filled.rentalId = await carOut(filled.businessId, filled.vehicleId, filled.samId);
    const change = await startChange(current(), filled.samId, filled.miaId);
    filled.checkInId = change.returnId;
    filled.miaHandoverId = change.handoverId;
    filled.phoneKey = randomUUID();
    filled.dentId = await addMark(change.returnId, "Dent", filled.phoneKey);
    // A key that is no mark's id is never taken for one.
    filled.notAMark = randomUUID();
    await finishWithCopies(current(), change, filled.miaId, [
      copyAsDeployed(change, "Dent", filled.dentId),
      copyAsDeployed(change, "Not a copy", filled.notAMark),
    ]);

    // Eight years back: two businesses' cancelled changes, each naming who was to take over.
    const named = await oldCancelledChange({
      driver: "Dan Old",
      proposed: "Eve Old",
      rego: "FIL592",
    });
    filled.eveId = named.proposedId;
    filled.eveChangeId = named.changeId;
    const parties = await oldCancelledChange({
      driver: "Fay Old",
      proposed: "Gus Old",
      rego: "FIL593",
    });
    filled.fayId = parties.driverId;
    filled.fayBusinessId = parties.businessId;
    filled.gusChangeId = parties.changeId;

    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")));
  });

  afterAll(async () => {
    await Promise.all([web?.end(), owner?.end()]);
    await superuser.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME} WITH (FORCE)`);
    await superuser.end();
    rmSync(folder, { recursive: true, force: true });
  });

  const reasonOf = async (changeId: string) =>
    (
      await asRole<{ reason: string }>(
        owner,
        filled.operatorId!,
        "select reason from rental_driver_changes where id = $1",
        [changeId],
      )
    )[0]?.reason;
  const retire = (renterId: string) =>
    asWeb<{ retired: boolean }>("select app.retire_renter($1) as retired", [renterId]);

  it("moves a copied mark's shown mark to its own column, and leaves the phone's keys alone", async () => {
    expect(await marksOn(filled.miaHandoverId!)).toEqual([
      { description: "Dent", clientKey: null, copiedFromMarkId: filled.dentId },
      { description: "Not a copy", clientKey: filled.notAMark, copiedFromMarkId: null },
    ]);
    expect(await marksOn(filled.checkInId!)).toEqual([
      { description: "Dent", clientKey: filled.phoneKey, copiedFromMarkId: null },
    ]);
  });

  it("moves across the copies the code deployed before still makes, each to the first mark", async () => {
    const change = await startChange(current(), filled.miaId!, filled.kimId!);
    const [copy] = await asWeb<{ id: string }>(
      "select id from inspection_damage_marks where inspection_id = $1 and description = 'Dent'",
      [filled.miaHandoverId],
    );
    // That code reads a moved copy's key as empty, so it names the copy itself.
    await finishWithCopies(current(), change, filled.kimId!, [
      copyAsDeployed(change, "Dent", copy!.id),
    ]);
    expect(await marksOn(change.handoverId)).toEqual([
      { description: "Dent", clientKey: null, copiedFromMarkId: filled.dentId },
    ]);
    // The phone's key on a checklist of its own still goes in as it is.
    const returnId = await addChecklist(filled.rentalId!, filled.vehicleId!, "return");
    const phoneKey = randomUUID();
    await addMark(returnId, "Chip", phoneKey);
    expect(await marksOn(returnId)).toEqual([
      { description: "Chip", clientKey: phoneKey, copiedFromMarkId: null },
    ]);
    await asWeb(`update inspections set status = 'cancelled', cancelled_at = now() where id = $1`, [
      returnId,
    ]);
  });

  it("refuses a mark copied from another business's mark", async () => {
    const change = await startChange(current(), filled.kimId!, filled.miaId!);
    await expect(
      asWeb(
        `insert into inspection_damage_marks (operator_id, inspection_id, x, y, description,
           copied_from_mark_id, created_by_user_id)
         values ($1, $2, 1, 1, 'Elsewhere', $3, $4)`,
        [filled.operatorId, change.handoverId, randomUUID(), filled.userId],
      ),
    ).rejects.toThrow(/inspection_damage_marks_copied_from_fk/);
    await cancelChange(change);
  });

  it("refuses a driver change finished at any other moment than now", async () => {
    // A car out since yesterday, so its hand-over can be dated back an hour.
    const carId = await addCar("FIL594");
    const car = {
      rentalId: await carOut(filled.businessId!, carId, filled.samId!),
      vehicleId: carId,
      renterId: filled.businessId!,
    };
    const change = await startChange(car, filled.samId!, filled.miaId!);
    for (const offset of [-HOUR_MS, HOUR_MS]) {
      await expect(
        finishWithCopies(car, change, filled.miaId!, [], new Date(Date.now() + offset)),
      ).rejects.toThrow(/completed at the moment it is signed/);
    }
    await finishWithCopies(car, change, filled.miaId!, []);
  });

  it("clears a cancelled change's reason with the driver it named, whoever else is kept", async () => {
    expect(await reasonOf(filled.eveChangeId!)).toBe("Eve Old was to take over");
    expect(await retire(filled.eveId!)).toEqual([{ retired: true }]);
    expect(await reasonOf(filled.eveChangeId!)).toBe(REMOVED);
  });

  it("clears a cancelled change's reason with the rental's real parties, the driver it named kept", async () => {
    expect(await retire(filled.fayId!)).toEqual([{ retired: true }]);
    expect(await reasonOf(filled.gusChangeId!)).toBe("Gus Old was to take over");
    expect(await retire(filled.fayBusinessId!)).toEqual([{ retired: true }]);
    expect(await reasonOf(filled.gusChangeId!)).toBe(REMOVED);
  });
});
