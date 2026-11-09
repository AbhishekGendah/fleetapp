import { drawnSignatureInput, type RenterSignatureInput } from "@fleetapp/core";
import {
  activityLog,
  inspections,
  possessions,
  rentalDriverChanges,
  rentals,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { emailDocumentAgain } from "../src/lib/contracts/document-emails";
import { createTemplate } from "../src/lib/contracts/templates";
import { completeHandover } from "../src/lib/handover/complete-handover";
import {
  completeDriverChange,
  loadDriverChangeViews,
  shownDriverChangeOf,
} from "../src/lib/handover/complete-driver-change";
import { completeReturn } from "../src/lib/handover/complete-return";
import { cancelHandover, startReturn } from "../src/lib/handover/handover-records";
import { startSwap } from "../src/lib/rentals/car-swaps";
import { bookRental } from "../src/lib/rentals/rental-records";
import {
  cancelDriverChange,
  listRentalDriverChanges,
  startDriverChange,
} from "../src/lib/rentals/driver-changes";
import { addExistingDriver, removeDriver } from "../src/lib/renters/organisation-driver-records";
import {
  archiveRenter,
  changeRenterStatus,
  createBusinessRenter,
} from "../src/lib/renters/renter-records";
import {
  emptyBusinessRenterForm,
  parseBusinessRenterForm,
} from "../src/lib/renters/business-renter-input";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { addCurrentPaperwork, addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, HANDOVER_KM, TEST_SIGNATURE } from "./handover-fixtures";
import { openTransactionAs, waitUntilBlockedBy } from "./lock-fixtures";
import {
  addRenterReadyToRent,
  attemptTestBooking,
  bookTestRentalOn,
  TEST_TIME_ZONE,
} from "./rental-fixtures";

const LEGAL_NAME = "Acme Rideshare Pty Ltd";
const CONTACT_EMAIL = "dana.wells@acme.example.test";
const SAM_EMAIL = "sam.lee@example.test";
const MIA_EMAIL = "mia.thompson@example.test";
const CHECK_IN_KM = HANDOVER_KM + 300;
const SECOND_MS = 1000;

const typed = (typedName: string): RenterSignatureInput => ({
  method: "typed",
  typedName,
  drawnSignature: "",
});

/**
 * Changing a business's driver while its car is out (docs/plans/
 * business-renters.md, slice 4): the car checked in from the driver who has
 * it, the new driver signing for it, possession moving from one to the
 * other at that one moment (rule 15), and everything else that takes the
 * driver from the car's record rather than the rental's driver now.
 */
describe("changing a business's driver while the car is out", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: Client;
  let storage: MemoryFileStorage;
  let actor: ActingUser;
  let otherActor: ActingUser;
  const sentEmails: EmailMessage[] = [];
  const clock = () => ({ timeZone: TEST_TIME_ZONE, now: new Date() });
  const kit = () => checklistKit(web, storage, sentEmails, actor);

  async function addDriver(businessId: string, name: string, email: string): Promise<string> {
    const driverId = await addRenterReadyToRent(web, kit().deps(), actor, name);
    await superuser.query("update renters set email = $2 where id = $1", [driverId, email]);
    expect((await addExistingDriver(web.db, actor, businessId, driverId)).status).toBe("added");
    return driverId;
  }

  /** A business's car out with Sam, who signed for it; Mia also drives for the business. */
  async function carOutWithSam() {
    const parsed = parseBusinessRenterForm({
      ...emptyBusinessRenterForm(),
      fullName: LEGAL_NAME,
      tradingName: "Acme Rides",
      abn: "51 824 753 556",
      contactName: "Dana Wells",
      email: CONTACT_EMAIL,
      businessAddress: "Unit 4, 12 Example Road, Osborne Park WA 6017",
    });
    const businessId = await createBusinessRenter(web.db, actor, parsed.data!);
    const samId = await addDriver(businessId, "Sam Lee", SAM_EMAIL);
    const miaId = await addDriver(businessId, "Mia Thompson", MIA_EMAIL);
    const vehicleId = await addTestCar(web, actor);
    await addCurrentPaperwork(web, actor, vehicleId);
    const booked = await bookTestRentalOn(web, actor, {
      renterId: businessId,
      vehicleId,
      driverId: samId,
    });
    await kit().signAndHoldBond(booked.rentalId);
    const handoverId = await kit().filledHandover(booked.rentalId);
    const handedOver = await completeHandover(
      kit().handoverDeps(),
      actor,
      handoverId,
      {
        shownFingerprint: await kit().shown(handoverId),
        signature: typed("Sam Lee"),
        bondOverrideReason: null,
        directDebitOverrideReason: null,
        insuranceOverrideReason: null,
        regoOverrideReason: null,
      },
      { timeZone: TEST_TIME_ZONE, now: new Date(Date.now() - 60 * SECOND_MS) },
    );
    expect(handedOver.status).toBe("completed");
    return { rentalId: booked.rentalId, vehicleId, businessId, samId, miaId };
  }

  /** The change to Mia started, its check-in filled in. */
  async function changeUnderWay(out: Awaited<ReturnType<typeof carOutWithSam>>) {
    const started = await startDriverChange(
      web.db,
      actor,
      out.rentalId,
      { toDriverId: out.miaId, reason: "Sam has moved to night shifts." },
      clock(),
    );
    expect(started.status).toBe("started");
    const [change] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(rentalDriverChanges).where(eq(rentalDriverChanges.rentalId, out.rentalId)),
    );
    await kit().fillChecklist(change!.returnInspectionId, CHECK_IN_KM);
    return change!;
  }

  /** The drivers sign as the phone showed it: Sam by `outgoing` (null: not there), Mia by `incoming`. */
  async function signChange(
    rentalId: string,
    outgoing: RenterSignatureInput | null,
    incoming: RenterSignatureInput = drawnSignatureInput(TEST_SIGNATURE),
    shown?: ReturnType<typeof shownDriverChangeOf>,
    deps = kit().handoverDeps(),
  ) {
    const views = await loadDriverChangeViews({ database: web.db }, actor.operatorId, rentalId);
    return completeDriverChange(
      deps,
      actor,
      rentalId,
      {
        shown:
          shown ??
          (views
            ? shownDriverChangeOf(views)
            : { changeId: "", returnFingerprint: "", handoverFingerprint: "" }),
        outgoingSignature: outgoing,
        incomingSignature: incoming,
      },
      clock(),
    );
  }

  const possessionsOf = (rentalId: string) =>
    withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({
          driverId: possessions.driverId,
          renterId: possessions.renterId,
          startedAt: possessions.startedAt,
          endedAt: possessions.endedAt,
        })
        .from(possessions)
        .where(eq(possessions.rentalId, rentalId))
        .orderBy(asc(possessions.startedAt)),
    );

  const driverOf = async (rentalId: string) =>
    (
      await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select({ driverId: rentals.driverId }).from(rentals).where(eq(rentals.id, rentalId)),
      )
    )[0]?.driverId;

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    storage = createMemoryFileStorage();
    actor = await seedOperatorWithUser(admin, "Driver Change Rentals Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Driver Change Rentals Pty Ltd");
    await createTemplate(web.db, actor, { kind: "swap_form", name: "Swap form" });
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.end()]);
  });

  describe("starting one", () => {
    it("starts only for a business's car that is out, to another of its current drivers", async () => {
      const out = await carOutWithSam();
      const start = (toDriverId: string, owner = actor) =>
        startDriverChange(web.db, owner, out.rentalId, { toDriverId, reason: "Shifts" }, clock());
      const stranger = await addRenterReadyToRent(web, kit().deps(), actor, "Kim Stranger");

      expect(await start(out.samId)).toEqual({ status: "same_driver" });
      expect(await start(stranger)).toEqual({ status: "driver_not_current" });
      expect(await start(out.miaId, otherActor)).toEqual({ status: "not_found" });
      const person = await kit().rentalOut(new Date(Date.now() - 60 * SECOND_MS));
      expect(
        await startDriverChange(
          web.db,
          actor,
          person.rentalId,
          { toDriverId: out.miaId, reason: "x" },
          clock(),
        ),
      ).toEqual({ status: "not_out" });
      expect((await start(out.miaId)).status).toBe("started");
      expect((await start(out.miaId)).status).toBe("resumed");
    });

    it("refuses starting a change to another driver while one to Mia is under way, never resuming hers", async () => {
      const out = await carOutWithSam();
      const kimId = await addDriver(out.businessId, "Kim Nguyen", "kim.nguyen@example.test");
      const change = await changeUnderWay(out);

      expect(
        await startDriverChange(
          web.db,
          actor,
          out.rentalId,
          { toDriverId: kimId, reason: "Kim is free" },
          clock(),
        ),
      ).toEqual({ status: "change_under_way" });
      const [still] = await listRentalDriverChanges(web.db, actor.operatorId, out.rentalId);
      expect(still).toMatchObject({ id: change.id, toDriverId: out.miaId, status: "in_progress" });
    });

    it("refuses a new driver marked Do not rent, saying why", async () => {
      const out = await carOutWithSam();
      await changeRenterStatus(web.db, actor, out.miaId, {
        status: "do_not_rent",
        doNotRentReason: "Unpaid fines",
      });

      const result = await startDriverChange(
        web.db,
        actor,
        out.rentalId,
        { toDriverId: out.miaId, reason: "Shifts" },
        clock(),
      );

      expect(result).toMatchObject({ status: "refused", problems: [{ code: "do_not_rent" }] });
    });

    it("keeps a driver change, a swap and a return apart: one at a time", async () => {
      const out = await carOutWithSam();
      const change = await changeUnderWay(out);
      const swapped = await startSwap(
        web.db,
        actor,
        out.rentalId,
        { toVehicleId: await addTestCar(web, actor), reason: "Engine light" },
        clock(),
      );
      const returned = await startReturn(web.db, actor, out.rentalId);

      expect(swapped).toEqual({ status: "driver_change_under_way" });
      expect(returned).toEqual({ status: "not_booked" });
      // The change's own checklists are never cancelled one by one.
      expect(await cancelHandover(web.db, actor, change.returnInspectionId)).toBe("not_found");
      expect(await cancelDriverChange(web.db, actor, out.rentalId)).toBe("cancelled");
      const swap = await startSwap(
        web.db,
        actor,
        out.rentalId,
        { toVehicleId: await addTestCar(web, actor), reason: "Engine light" },
        clock(),
      );
      expect(swap.status).toBe("started");
      expect(
        await startDriverChange(
          web.db,
          actor,
          out.rentalId,
          { toDriverId: out.miaId, reason: "Shifts" },
          clock(),
        ),
      ).toEqual({ status: "swap_under_way" });
    });
  });

  describe("signing it", () => {
    it("moves the car from Sam to Mia at one moment, each signing in their own name", async () => {
      const out = await carOutWithSam();
      const change = await changeUnderWay(out);
      sentEmails.length = 0;

      expect((await signChange(out.rentalId, typed("Mia Thompson"))).status).toBe(
        "no_outgoing_signature",
      );
      expect((await signChange(out.rentalId, typed("Sam Lee"), typed(LEGAL_NAME))).status).toBe(
        "no_signature",
      );
      const before = Date.now();
      const done = await signChange(out.rentalId, typed("Sam Lee"), typed("Mia Thompson"));

      expect(done.status).toBe("completed");
      const held = await possessionsOf(out.rentalId);
      expect(held.map((row) => row.driverId)).toEqual([out.samId, out.miaId]);
      expect(held.every((row) => row.renterId === out.businessId)).toBe(true);
      expect(held[0]?.endedAt?.getTime()).toBe(held[1]?.startedAt.getTime());
      expect(held[1]?.endedAt).toBeNull();
      expect(held[1]!.startedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(await driverOf(out.rentalId)).toBe(out.miaId);
      const checklists = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({
            id: inspections.id,
            status: inspections.status,
            odometerKm: inspections.odometerKm,
            acceptanceText: inspections.acceptanceText,
          })
          .from(inspections)
          .where(inArray(inspections.id, [change.returnInspectionId, change.handoverInspectionId])),
      );
      const checkIn = checklists.find((row) => row.id === change.returnInspectionId);
      const takenOver = checklists.find((row) => row.id === change.handoverInspectionId);
      expect(checkIn?.acceptanceText).toMatch(/^I, Sam Lee, returned this car for Acme Rideshare/);
      expect(takenOver?.acceptanceText).toMatch(/^I, Mia Thompson, received this car for Acme/);
      expect(takenOver).toMatchObject({ status: "completed", odometerKm: CHECK_IN_KM });
      // Each driver gets the report they signed, to their own email; the contact gets both.
      const toSam = sentEmails.filter((email) => email.to === SAM_EMAIL);
      const toMia = sentEmails.filter((email) => email.to === MIA_EMAIL);
      expect(toSam.map((email) => email.subject)).toEqual([expect.stringMatching(/return report/)]);
      expect(toMia.map((email) => email.subject)).toEqual([
        expect.stringMatching(/handover report/),
      ]);
      expect(toSam[0]?.text).toContain("Hi Sam Lee,");
      expect(toMia[0]?.text).toContain("Hi Mia Thompson,");
      expect(sentEmails.filter((email) => email.to === CONTACT_EMAIL)).toHaveLength(2);
      const [summary] = await listRentalDriverChanges(web.db, actor.operatorId, out.rentalId);
      expect(summary).toMatchObject({
        status: "completed",
        fromName: "Sam Lee",
        toName: "Mia Thompson",
      });
    });

    it("answers a fine-style lookup with who had the car at the moment, never the driver now", async () => {
      const out = await carOutWithSam();
      await changeUnderWay(out);
      expect((await signChange(out.rentalId, null)).status).toBe("completed");
      const [samTime, miaTime] = await possessionsOf(out.rentalId);
      const changedAt = miaTime!.startedAt;
      const whoHad = async (moment: Date) => {
        const rows = await superuser.query<{ driverId: string }>(
          `select driver_id as "driverId" from possessions
           where vehicle_id = $1 and held_during @> $2::timestamptz`,
          [out.vehicleId, moment],
        );
        return rows.rows.map((row) => row.driverId);
      };

      expect(samTime?.endedAt?.getTime()).toBe(changedAt.getTime());
      expect(await whoHad(new Date(changedAt.getTime() - SECOND_MS))).toEqual([out.samId]);
      expect(await whoHad(changedAt)).toEqual([out.miaId]);
    });

    it("records Sam as not there when he isn't, as for a return", async () => {
      const out = await carOutWithSam();
      const change = await changeUnderWay(out);

      expect((await signChange(out.rentalId, null)).status).toBe("completed");

      const [checkIn] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ text: inspections.acceptanceText, isAbsent: inspections.isRenterAbsent })
          .from(inspections)
          .where(eq(inspections.id, change.returnInspectionId)),
      );
      expect(checkIn).toMatchObject({ isAbsent: true });
      expect(checkIn?.text).toMatch(/^The driver was not present\./);
    });

    it("refuses as changed when the new driver's name or the check-in changes after the phone showed it", async () => {
      const out = await carOutWithSam();
      const change = await changeUnderWay(out);
      const views = await loadDriverChangeViews(
        { database: web.db },
        actor.operatorId,
        out.rentalId,
      );
      const shown = shownDriverChangeOf(views!);
      await superuser.query("update renters set full_name = 'Mia Thomson' where id = $1", [
        out.miaId,
      ]);

      expect((await signChange(out.rentalId, null, undefined, shown)).status).toBe("changed");
      await superuser.query("update renters set full_name = 'Mia Thompson' where id = $1", [
        out.miaId,
      ]);
      await superuser.query("update inspections set fuel_level = 'half' where id = $1", [
        change.returnInspectionId,
      ]);
      expect((await signChange(out.rentalId, null, undefined, shown)).status).toBe("changed");
      expect(await driverOf(out.rentalId)).toBe(out.samId);
      expect(await possessionsOf(out.rentalId)).toHaveLength(1);
    });

    it("refuses as changed when the business's legal name changes after the phone showed it", async () => {
      const out = await carOutWithSam();
      await changeUnderWay(out);
      const views = await loadDriverChangeViews(
        { database: web.db },
        actor.operatorId,
        out.rentalId,
      );
      await superuser.query("update renters set full_name = 'Acme Fleet Pty Ltd' where id = $1", [
        out.businessId,
      ]);

      const result = await signChange(out.rentalId, null, undefined, shownDriverChangeOf(views!));

      expect(result.status).toBe("changed");
    });

    it("refuses the new driver marked Do not rent after the change began, in words", async () => {
      const out = await carOutWithSam();
      await changeUnderWay(out);
      await changeRenterStatus(web.db, actor, out.miaId, {
        status: "do_not_rent",
        doNotRentReason: "Unpaid fines",
      });

      const result = await signChange(out.rentalId, null);

      expect(result).toMatchObject({ status: "refused", problems: [{ code: "do_not_rent" }] });
      expect(await possessionsOf(out.rentalId)).toHaveLength(1);
    });

    it("logs the change by record ids, never by a driver's name or the reason", async () => {
      const out = await carOutWithSam();
      const change = await changeUnderWay(out);
      await signChange(out.rentalId, null);

      const lines = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ after: activityLog.valuesAfter, before: activityLog.valuesBefore })
          .from(activityLog)
          .where(
            and(eq(activityLog.operatorId, actor.operatorId), eq(activityLog.entityId, change.id)),
          ),
      );
      const rentalLines = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ after: activityLog.valuesAfter })
          .from(activityLog)
          .where(eq(activityLog.entityId, out.rentalId)),
      );
      const written = JSON.stringify([lines, rentalLines]);
      expect(written).not.toContain("Mia Thompson");
      expect(written).not.toContain("Sam Lee");
      expect(written).not.toContain("night shifts");
      expect(rentalLines.map((line) => line.after)).toContainEqual({ driverId: out.miaId });
    });
  });

  describe("after the change, the car's record names who signs", () => {
    it("has Mia, not Sam, sign the return, and compares it with her handover", async () => {
      const out = await carOutWithSam();
      await changeUnderWay(out);
      expect((await signChange(out.rentalId, null)).status).toBe("completed");
      const started = await startReturn(web.db, actor, out.rentalId);
      const returnId = "inspectionId" in started ? started.inspectionId : "";
      await kit().fillChecklist(returnId, CHECK_IN_KM + 200);
      const returnAs = async (name: string) =>
        completeReturn(
          kit().handoverDeps(),
          actor,
          returnId,
          {
            shownFingerprint: await kit().shown(returnId),
            returnedAt: new Date(),
            signature: typed(name),
            carAfter: { status: "available", statusReason: null, statusExpectedBack: null },
          },
          clock(),
        );

      expect((await returnAs("Sam Lee")).status).toBe("no_signature");
      sentEmails.length = 0;
      expect((await returnAs("Mia Thompson")).status).toBe("completed");
      expect(sentEmails.filter((email) => email.to === MIA_EMAIL)).toHaveLength(1);
      expect(sentEmails.filter((email) => email.to === SAM_EMAIL)).toHaveLength(0);
    });

    it("has Mia sign a later swap, and moves her possession to the new car", async () => {
      const out = await carOutWithSam();
      await changeUnderWay(out);
      expect((await signChange(out.rentalId, null)).status).toBe("completed");
      const swapped = await startSwap(
        web.db,
        actor,
        out.rentalId,
        { toVehicleId: await addTestCar(web, actor), reason: "Engine light" },
        clock(),
      );
      expect(swapped.status).toBe("started");
      const { completeSwap, currentShownSwap } = await import("../src/lib/handover/complete-swap");
      const [swap] = await superuser
        .query<{ returnId: string; handoverId: string }>(
          `select return_inspection_id as "returnId", handover_inspection_id as "handoverId"
         from car_swaps where rental_id = $1`,
          [out.rentalId],
        )
        .then((result) => result.rows);
      await kit().fillChecklist(swap!.returnId, CHECK_IN_KM + 100);
      await kit().fillChecklist(swap!.handoverId, 12_050);
      const swapAs = async (name: string) =>
        completeSwap(
          kit().handoverDeps(),
          actor,
          out.rentalId,
          {
            shown: (await currentShownSwap(
              { database: web.db },
              actor.operatorId,
              out.rentalId,
              clock(),
            ))!,
            signature: typed(name),
            oldCarAfter: { status: "available", statusReason: null, statusExpectedBack: null },
          },
          clock(),
        );

      expect((await swapAs("Sam Lee")).status).toBe("no_signature");
      expect((await swapAs("Mia Thompson")).status).toBe("completed");
      const held = await possessionsOf(out.rentalId);
      expect(held.map((row) => row.driverId)).toEqual([out.samId, out.miaId, out.miaId]);
    });

    it("emails each report again to the driver who signed it, from the report's own possession", async () => {
      const out = await carOutWithSam();
      await changeUnderWay(out);
      // No copy goes as it is signed: the mail service is down.
      const noEmail = {
        async send(): Promise<void> {
          throw new Error("The mail service is down");
        },
      };
      const done = await signChange(out.rentalId, typed("Sam Lee"), undefined, undefined, {
        ...kit().handoverDeps(),
        emailSender: noEmail,
      });
      if (done.status !== "completed") {
        throw new Error(`The change did not complete: ${done.status}`);
      }
      sentEmails.length = 0;

      await emailDocumentAgain(kit().handoverDeps(), actor, done.returnDocumentId, TEST_TIME_ZONE);
      const returnCopies = sentEmails.map((email) => email.to);
      sentEmails.length = 0;
      await emailDocumentAgain(
        kit().handoverDeps(),
        actor,
        done.handoverDocumentId,
        TEST_TIME_ZONE,
      );

      expect(returnCopies).toContain(SAM_EMAIL);
      expect(returnCopies).not.toContain(MIA_EMAIL);
      expect(sentEmails.map((email) => email.to)).toContain(MIA_EMAIL);
      expect(sentEmails.map((email) => email.to)).not.toContain(SAM_EMAIL);
    });
  });

  describe("at the same moment as something else (lock order)", () => {
    const statusOf = async (changeId: string) =>
      (
        await superuser.query<{ status: string }>(
          "select status from rental_driver_changes where id = $1",
          [changeId],
        )
      ).rows[0]?.status;

    it("finishes the signing that reached the rental first; cancelling is then refused", async () => {
      const out = await carOutWithSam();
      const change = await changeUnderWay(out);
      // Holding the new driver's checklist: signing takes the rental, the change and the check-in, then waits.
      const holder = await openTransactionAs(actor.operatorId);
      await holder.client.query("select id from inspections where id = $1 for update", [
        change.handoverInspectionId,
      ]);
      const signed = signChange(out.rentalId, null);
      await waitUntilBlockedBy(superuser, holder.pid);
      const cancelled = cancelDriverChange(web.db, actor, out.rentalId);
      await waitUntilBlockedBy(superuser, holder.pid, 2);
      await holder.client.query("commit");
      await holder.client.end();

      expect((await signed).status).toBe("completed");
      expect(await cancelled).toBe("finished_already");
      expect(await statusOf(change.id)).toBe("completed");
    });

    it("cancels the change that reached the rental first; signing is then refused as finished", async () => {
      const out = await carOutWithSam();
      const change = await changeUnderWay(out);
      const holder = await openTransactionAs(actor.operatorId);
      await holder.client.query("select id from rentals where id = $1 for update", [out.rentalId]);
      const cancelled = cancelDriverChange(web.db, actor, out.rentalId);
      await waitUntilBlockedBy(superuser, holder.pid);
      const signed = signChange(out.rentalId, null);
      await waitUntilBlockedBy(superuser, holder.pid, 2);
      await holder.client.query("commit");
      await holder.client.end();

      expect(await cancelled).toBe("cancelled");
      expect((await signed).status).toBe("finished_already");
      expect(await statusOf(change.id)).toBe("cancelled");
      expect(await driverOf(out.rentalId)).toBe(out.samId);
    });

    it("holds the new driver's removal back while signing; the removal is then refused", async () => {
      const out = await carOutWithSam();
      const change = await changeUnderWay(out);
      // Holding the business: signing waits for it (after the rental), the removal behind it.
      const holder = await openTransactionAs(actor.operatorId);
      await holder.client.query("select id from renters where id = $1 for update", [
        out.businessId,
      ]);
      const signed = signChange(out.rentalId, null);
      await waitUntilBlockedBy(superuser, holder.pid);
      const removed = removeDriver(web.db, actor, out.businessId, out.miaId);
      await waitUntilBlockedBy(superuser, holder.pid, 2);
      await holder.client.query("commit");
      await holder.client.end();

      expect((await signed).status).toBe("completed");
      expect(await removed).toBe("named_on_rental");
      expect(await statusOf(change.id)).toBe("completed");
    });

    it("refuses removing the new driver while a change hands them the car, whichever comes first", async () => {
      const out = await carOutWithSam();
      const change = await changeUnderWay(out);
      const holder = await openTransactionAs(actor.operatorId);
      await holder.client.query("select id from renters where id = $1 for update", [
        out.businessId,
      ]);
      const removed = removeDriver(web.db, actor, out.businessId, out.miaId);
      await waitUntilBlockedBy(superuser, holder.pid);
      const signed = signChange(out.rentalId, null);
      await waitUntilBlockedBy(superuser, holder.pid, 2);
      await holder.client.query("commit");
      await holder.client.end();

      expect(await removed).toBe("named_on_rental");
      expect((await signed).status).toBe("completed");
      expect(await statusOf(change.id)).toBe("completed");
    });

    it("waits for an archive of the new driver; the archive is refused and the change goes ahead", async () => {
      const out = await carOutWithSam();
      const change = await changeUnderWay(out);
      const holder = await openTransactionAs(actor.operatorId);
      await holder.client.query("select id from renters where id = $1 for update", [out.miaId]);
      const archived = archiveRenter(web.db, actor, out.miaId);
      await waitUntilBlockedBy(superuser, holder.pid);
      const signed = signChange(out.rentalId, null);
      await waitUntilBlockedBy(superuser, holder.pid, 2);
      await holder.client.query("commit");
      await holder.client.end();

      expect(await archived).toBe("drives_for");
      expect((await signed).status).toBe("completed");
      expect(await statusOf(change.id)).toBe("completed");
    });

    /** A later booking of the business's car, made new or from a draft, as the booking screens do. */
    const LATER_PERIOD = { plannedStart: "2028-03-01T09:00", plannedEnd: "2028-03-29T09:00" };
    const bookings = {
      "a new rental": async (out: Awaited<ReturnType<typeof carOutWithSam>>) => () =>
        attemptTestBooking(web, actor, {
          renterId: out.businessId,
          vehicleId: out.vehicleId,
          period: LATER_PERIOD,
        }),
      "a draft being booked": async (out: Awaited<ReturnType<typeof carOutWithSam>>) => {
        const draft = await attemptTestBooking(web, actor, {
          renterId: out.businessId,
          vehicleId: out.vehicleId,
          period: LATER_PERIOD,
          status: "draft",
        });
        expect(draft.status).toBe("saved");
        const draftId = draft.status === "saved" ? draft.rentalId : "";
        return () => bookRental(web.db, actor, draftId, clock());
      },
    } as const;
    const changeSteps = {
      starting: async (out: Awaited<ReturnType<typeof carOutWithSam>>) => ({
        expected: "started",
        run: () =>
          startDriverChange(
            web.db,
            actor,
            out.rentalId,
            { toDriverId: out.miaId, reason: "Shifts" },
            clock(),
          ),
      }),
      finishing: async (out: Awaited<ReturnType<typeof carOutWithSam>>) => {
        await changeUnderWay(out);
        return { expected: "completed", run: () => signChange(out.rentalId, null) };
      },
    } as const;
    const outcomeOf = (pending: Promise<{ status: string }>) =>
      pending.then(
        (result) => result.status,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    const raceCases = (["starting", "finishing"] as const).flatMap((step) =>
      (["a new rental", "a draft being booked"] as const).flatMap((booking) =>
        (["the driver change", "the booking"] as const).map((first) => ({ step, booking, first })),
      ),
    );

    // Each takes the car before the business ("Lock order"), so neither deadlocks (review of slice 4).
    it.each(raceCases)(
      "lets $step a driver change and $booking of the same car both go ahead, $first first",
      async ({ step, booking, first }) => {
        const out = await carOutWithSam();
        const change = await changeSteps[step](out);
        const book = await bookings[booking](out);
        const isChangeFirst = first === "the driver change";
        // Holding what the first one waits for, so the second arrives while it waits.
        const holder = await openTransactionAs(actor.operatorId);
        await holder.client.query(
          isChangeFirst
            ? "select id from renters where id = $1 for update"
            : "select id from vehicles where id = $1 for update",
          [isChangeFirst ? out.businessId : out.vehicleId],
        );
        const [runFirst, runSecond] = isChangeFirst ? [change.run, book] : [book, change.run];
        const firstDone = outcomeOf(runFirst());
        await waitUntilBlockedBy(superuser, holder.pid);
        const secondDone = outcomeOf(runSecond());
        await waitUntilBlockedBy(superuser, holder.pid, 2);
        await holder.client.query("commit");
        await holder.client.end();

        const [changed, booked] = isChangeFirst
          ? [await firstDone, await secondDone]
          : [await secondDone, await firstDone];
        expect(changed).toBe(change.expected);
        expect(booked).toBe("saved");
      },
    );

    it("lets one of a swap and a driver change start when both are asked at once", async () => {
      const out = await carOutWithSam();
      const newCarId = await addTestCar(web, actor);
      const holder = await openTransactionAs(actor.operatorId);
      await holder.client.query("select id from rentals where id = $1 for update", [out.rentalId]);
      const changed = startDriverChange(
        web.db,
        actor,
        out.rentalId,
        { toDriverId: out.miaId, reason: "Shifts" },
        clock(),
      );
      await waitUntilBlockedBy(superuser, holder.pid);
      const swapped = startSwap(
        web.db,
        actor,
        out.rentalId,
        { toVehicleId: newCarId, reason: "Engine light" },
        clock(),
      );
      await waitUntilBlockedBy(superuser, holder.pid, 2);
      await holder.client.query("commit");
      await holder.client.end();

      expect((await changed).status).toBe("started");
      expect(await swapped).toEqual({ status: "driver_change_under_way" });
    });

    it("lets one of a return and a driver change start when both are asked at once", async () => {
      const out = await carOutWithSam();
      const holder = await openTransactionAs(actor.operatorId);
      await holder.client.query("select id from rentals where id = $1 for update", [out.rentalId]);
      const returned = startReturn(web.db, actor, out.rentalId);
      await waitUntilBlockedBy(superuser, holder.pid);
      const changed = startDriverChange(
        web.db,
        actor,
        out.rentalId,
        { toDriverId: out.miaId, reason: "Shifts" },
        clock(),
      );
      await waitUntilBlockedBy(superuser, holder.pid, 2);
      await holder.client.query("commit");
      await holder.client.end();

      expect((await returned).status).toBe("started");
      expect(await changed).toEqual({ status: "checklist_under_way" });
    });
  });

  describe("tenancy", () => {
    it("never lets another Operator see, sign or cancel a change, or hand the car to their own person", async () => {
      const out = await carOutWithSam();
      await changeUnderWay(out);
      const theirPerson = await addRenterReadyToRent(web, kit().deps(), otherActor, "Other Person");

      expect(
        await loadDriverChangeViews({ database: web.db }, otherActor.operatorId, out.rentalId),
      ).toBeNull();
      expect(await cancelDriverChange(web.db, otherActor, out.rentalId)).toBe("not_found");
      expect(await listRentalDriverChanges(web.db, otherActor.operatorId, out.rentalId)).toEqual(
        [],
      );
      const signed = await completeDriverChange(
        kit().handoverDeps(),
        otherActor,
        out.rentalId,
        {
          shown: { changeId: "", returnFingerprint: "", handoverFingerprint: "" },
          outgoingSignature: null,
          incomingSignature: drawnSignatureInput(TEST_SIGNATURE),
        },
        clock(),
      );
      expect(signed.status).toBe("not_found");
      await cancelDriverChange(web.db, actor, out.rentalId);
      expect(
        await startDriverChange(
          web.db,
          actor,
          out.rentalId,
          { toDriverId: theirPerson, reason: "Shifts" },
          clock(),
        ),
      ).toEqual({ status: "driver_not_found" });
    });
  });
});
