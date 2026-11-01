import { WITHHELD_VALUE, type ListQuery } from "@fleetapp/core";
import { activityLog, carHolds, rentalRates, rentals, vehicles } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import {
  emptyRentalForm,
  parseRentalForm,
  type RentalFormValues,
  type RentalInput,
} from "../src/lib/rentals/rental-input";
import {
  listCalendarBookings,
  listRentalPage,
  loadRental,
} from "../src/lib/rentals/rental-queries";
import { bookingClashMessage, bookingProblemMessage } from "../src/lib/rentals/rental-messages";
import {
  bookRental,
  cancelRental,
  createRental,
  type BookingResult,
  type RentalClock,
} from "../src/lib/rentals/rental-records";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { changeRenterStatus, createRenter } from "../src/lib/renters/renter-records";
import { saveOperatorSettings } from "../src/lib/settings/operator-settings";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";

const TIME_ZONE = "Australia/Perth";
/** Two days before the first test booking, so it is "starting soon". */
const CLOCK: RentalClock = { timeZone: TIME_ZONE, now: new Date("2026-11-29T00:00:00Z") };
const TUESDAY = 2;
/** The whole list, soonest first, as the Rentals page opens. */
function rentalQuery(search = ""): ListQuery {
  return { search, sort: { column: "start", direction: "asc" }, filters: {}, page: 1 };
}
const MONDAY = 1;

function rentalForm(
  ids: { renterId: string; vehicleId: string },
  changes: Partial<RentalFormValues> = {},
): RentalFormValues {
  return {
    ...emptyRentalForm(ids),
    plannedStart: "2026-12-01T09:00",
    plannedEnd: "2026-12-29T09:00",
    weeklyRateCents: "350.00",
    bondCents: "500",
    ...changes,
  };
}

function parsed(values: RentalFormValues): RentalInput {
  const result = parseRentalForm(values, TIME_ZONE);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.data;
}

function savedId(result: BookingResult): string {
  if (result.status !== "saved") {
    throw new Error(`The rental was not saved: ${result.status}`);
  }
  return result.rentalId;
}

describe("the New rental form's rules", () => {
  const ids = {
    renterId: "00000000-0000-4000-8000-000000000001",
    vehicleId: "00000000-0000-4000-8000-000000000002",
  };

  it("reads times on the Operator's clock and keeps them in UTC", () => {
    expect(parsed(rentalForm(ids))).toMatchObject({
      plannedStart: new Date("2026-12-01T01:00:00Z"),
      plannedEnd: new Date("2026-12-29T01:00:00Z"),
      weeklyRateCents: 35_000,
      bondCents: 50_000,
      chargeWeekday: null,
      notes: null,
    });
  });

  it("needs an end after the start for a fixed term, and drops the end when ongoing", () => {
    const fieldsWithErrors = (values: RentalFormValues) => {
      const result = parseRentalForm(values, TIME_ZONE);
      return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
    };
    expect(fieldsWithErrors(rentalForm(ids, { plannedEnd: "" }))).toEqual(["plannedEnd"]);
    expect(fieldsWithErrors(rentalForm(ids, { plannedEnd: "2026-12-01T09:00" }))).toEqual([
      "plannedEnd",
    ]);
    expect(parsed(rentalForm(ids, { type: "ongoing" })).plannedEnd).toBeNull();
  });

  it("needs a Renter, a car and a weekly rate above nothing", () => {
    const result = parseRentalForm(
      rentalForm({ renterId: "", vehicleId: "not-an-id" }, { weeklyRateCents: "0" }),
      TIME_ZONE,
    );
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path[0])).toEqual([
      "renterId",
      "vehicleId",
      "weeklyRateCents",
    ]);
  });

  it("takes a chosen charge day, or none to work it out", () => {
    expect(parsed(rentalForm(ids, { chargeWeekday: "5" })).chargeWeekday).toBe(5);
    expect(parseRentalForm(rentalForm(ids, { chargeWeekday: "8" }), TIME_ZONE).success).toBe(false);
  });
});

describe("booking messages", () => {
  it("names the booking in the way on the Operator's clock", () => {
    const clash = {
      rentalId: "00000000-0000-4000-8000-000000000003",
      plannedStart: new Date("2026-12-01T01:00:00Z"),
      plannedEnd: null,
    };
    expect(bookingClashMessage(clash, TIME_ZONE)).toBe(
      "This car is already booked from 1 Dec 2026, 9:00 am AWST with no end date (ongoing). Choose other dates or another car.",
    );
  });

  it("lists what is still needed before handover", () => {
    expect(
      bookingProblemMessage({
        code: "details_missing",
        level: "handover",
        missing: ["dateOfBirth", "licenceScans"],
      }),
    ).toBe("Still needed before the car is handed over: date of birth, licence front and back.");
  });
});

describe("rentals in the Operator app", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherActor: ActingUser;
  let renterId: string;

  async function addRenter(owner: ActingUser, name = "Sam Example"): Promise<string> {
    const result = parseRenterForm(
      { ...emptyRenterForm(), fullName: name, phone: "0412345678" },
      "2026-10-30",
    );
    return createRenter(web.db, owner, result.data!);
  }

  function book(
    vehicleId: string,
    changes: Partial<RentalFormValues> = {},
    owner: ActingUser = actor,
    forRenter: string = renterId,
  ): Promise<BookingResult> {
    const input = parsed(rentalForm({ renterId: forRenter, vehicleId }, changes));
    return createRental(web.db, owner, input, "booked", CLOCK);
  }

  function liveHoldsOf(rentalId: string) {
    return withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ releasedAt: carHolds.releasedAt })
        .from(carHolds)
        .where(eq(carHolds.rentalId, rentalId)),
    );
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Rentals Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Rentals Pty Ltd");
    renterId = await addRenter(actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  describe("making one", () => {
    it("saves a draft without holding the car, with the settings and first rate", async () => {
      const vehicleId = await addTestCar(web, actor);
      const input = parsed(rentalForm({ renterId, vehicleId }, { notes: "Pays in cash" }));

      const rentalId = savedId(await createRental(web.db, actor, input, "draft", CLOCK));

      const [rental] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select().from(rentals).where(eq(rentals.id, rentalId)),
      );
      expect(rental).toMatchObject({
        status: "draft",
        chargeWeekday: TUESDAY,
        settingsVersion: 0,
        settingsSnapshot: expect.objectContaining({ minimumRenterAgeYears: 21 }),
      });
      expect(await liveHoldsOf(rentalId)).toEqual([]);
      const rates = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ cents: rentalRates.weeklyRateCents, from: rentalRates.appliesFrom })
          .from(rentalRates)
          .where(eq(rentalRates.rentalId, rentalId)),
      );
      expect(rates).toEqual([{ cents: 35_000, from: "2026-12-01" }]);
    });

    it("logs it with the warnings it was booked with, never the notes", async () => {
      const vehicleId = await addTestCar(web, actor);
      const result = await book(vehicleId, { notes: "Pays in cash" });
      const rentalId = savedId(result);

      const [line] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ action: activityLog.action, after: activityLog.valuesAfter })
          .from(activityLog)
          .where(and(eq(activityLog.entityType, "rental"), eq(activityLog.entityId, rentalId))),
      );
      expect(result.status === "saved" && result.problems.map((problem) => problem.code)).toEqual([
        "details_missing",
      ]);
      expect(line).toMatchObject({
        action: "created",
        after: expect.objectContaining({
          status: "booked",
          notes: WITHHELD_VALUE,
          weeklyRateCents: 35_000,
          warnings: ["details_missing"],
        }),
      });
    });

    it("charges on the business's fixed day when it has one", async () => {
      const owner = await seedOperatorWithUser(admin, "Fixed Day Pty Ltd");
      await saveOperatorSettings(web.db, owner, { fixedChargeWeekday: MONDAY });
      const vehicleId = await addTestCar(web, owner);

      const rentalId = savedId(await book(vehicleId, {}, owner, await addRenter(owner)));

      const detail = await loadRental(web.db, owner.operatorId, rentalId, CLOCK);
      expect(detail).toMatchObject({ chargeWeekday: MONDAY, settingsVersion: 1 });
    });

    it("refuses a Renter marked Do not rent, and a car that has left the fleet", async () => {
      const doNotRent = await addRenter(actor, "Alex Example");
      await changeRenterStatus(web.db, actor, doNotRent, {
        status: "do_not_rent",
        doNotRentReason: "Unpaid tolls",
      });
      const writtenOff = await addTestCar(web, actor);
      await withTenant(web.db, actor.operatorId, (tx) =>
        tx.update(vehicles).set({ status: "written_off" }).where(eq(vehicles.id, writtenOff)),
      );

      const refusedRenter = await book(await addTestCar(web, actor), {}, actor, doNotRent);
      const refusedCar = await book(writtenOff);

      expect([refusedRenter.status, refusedCar.status]).toEqual(["refused", "refused"]);
    });

    it("never books another Operator's Renter or car", async () => {
      const theirCar = await addTestCar(web, otherActor);
      const theirRenter = await addRenter(otherActor);

      const results = await Promise.all([
        book(theirCar),
        book(await addTestCar(web, actor), {}, actor, theirRenter),
      ]);

      expect(results.map((result) => result.status)).toEqual(["car_not_found", "renter_not_found"]);
    });
  });

  describe("no double bookings", () => {
    it("says which booking has the car, and keeps nothing of the refused one", async () => {
      const vehicleId = await addTestCar(web, actor);
      const first = savedId(await book(vehicleId));

      const second = await book(vehicleId, {
        plannedStart: "2026-12-28T09:00",
        plannedEnd: "2027-01-04T09:00",
      });

      expect(second).toEqual({
        status: "car_taken",
        clash: {
          rentalId: first,
          plannedStart: new Date("2026-12-01T01:00:00Z"),
          plannedEnd: new Date("2026-12-29T01:00:00Z"),
        },
      });
      const onCar = await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select({ id: rentals.id }).from(rentals).where(eq(rentals.vehicleId, vehicleId)),
      );
      expect(onCar).toEqual([{ id: first }]);
    });

    it("lets the next booking start as the last one ends", async () => {
      const vehicleId = await addTestCar(web, actor);
      await book(vehicleId);

      const next = await book(vehicleId, {
        plannedStart: "2026-12-29T09:00",
        plannedEnd: "2027-01-05T09:00",
      });

      expect(next.status).toBe("saved");
    });

    it("keeps an ongoing rental's car from every later booking", async () => {
      const vehicleId = await addTestCar(web, actor);
      await book(vehicleId, { type: "ongoing" });

      const later = await book(vehicleId, {
        plannedStart: "2027-06-01T09:00",
        plannedEnd: "2027-06-08T09:00",
      });

      expect(later.status).toBe("car_taken");
    });
  });

  describe("drafts and cancelling", () => {
    it("books a draft, holding its car, and only once", async () => {
      const vehicleId = await addTestCar(web, actor);
      const input = parsed(rentalForm({ renterId, vehicleId }));
      const rentalId = savedId(await createRental(web.db, actor, input, "draft", CLOCK));

      const booked = await bookRental(web.db, actor, rentalId, CLOCK);
      const again = await bookRental(web.db, actor, rentalId, CLOCK);

      expect([booked.status, again.status]).toEqual(["saved", "not_allowed"]);
      expect(await liveHoldsOf(rentalId)).toEqual([{ releasedAt: null }]);
    });

    it("cannot book a draft once its car has gone to someone else", async () => {
      const vehicleId = await addTestCar(web, actor);
      const input = parsed(rentalForm({ renterId, vehicleId }));
      const draft = savedId(await createRental(web.db, actor, input, "draft", CLOCK));
      await book(vehicleId);

      const result = await bookRental(web.db, actor, draft, CLOCK);

      expect(result.status).toBe("car_taken");
    });

    it("lets the car go when a booking is cancelled, keeping the reason out of the log", async () => {
      const vehicleId = await addTestCar(web, actor);
      const rentalId = savedId(await book(vehicleId));

      const result = await cancelRental(
        web.db,
        actor,
        rentalId,
        { reason: "Renter changed plans" },
        CLOCK.now,
      );

      expect(result).toBe("cancelled");
      expect((await book(vehicleId)).status).toBe("saved");
      const lines = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ after: activityLog.valuesAfter })
          .from(activityLog)
          .where(and(eq(activityLog.entityId, rentalId), eq(activityLog.action, "status_changed"))),
      );
      expect(lines).toEqual([
        { after: { status: "cancelled", cancellationReason: WITHHELD_VALUE } },
      ]);
      expect(await cancelRental(web.db, actor, rentalId, { reason: "Again" }, CLOCK.now)).toBe(
        "not_allowed",
      );
    });

    it("never cancels another Operator's rental", async () => {
      const rentalId = savedId(await book(await addTestCar(web, actor)));

      expect(
        await cancelRental(web.db, otherActor, rentalId, { reason: "Not mine" }, CLOCK.now),
      ).toBe("not_found");
    });
  });

  describe("lists", () => {
    it("finds rentals by rego, only the car's on its tab, with Starting soon", async () => {
      const vehicleId = await addTestCar(web, actor, { rego: "RENT01" });
      const rentalId = savedId(await book(vehicleId));
      await book(await addTestCar(web, actor));

      const searched = await listRentalPage(web.db, actor.operatorId, rentalQuery("rent01"), {
        clock: CLOCK,
      });
      const onCarTab = await listRentalPage(web.db, actor.operatorId, rentalQuery(), {
        clock: CLOCK,
        scope: { vehicleId },
      });

      expect(searched.rows.map((row) => row.id)).toEqual([rentalId]);
      expect(onCarTab.rows).toEqual([
        expect.objectContaining({
          id: rentalId,
          rego: "RENT01",
          weeklyRateCents: 35_000,
          isStartingSoon: true,
          isOverdue: false,
          isAtRisk: false,
        }),
      ]);
    });

    it("flags a car kept past its end, and puts its next booking at risk", async () => {
      const vehicleId = await addTestCar(web, actor);
      const late = savedId(await book(vehicleId));
      const next = savedId(
        await book(vehicleId, { plannedStart: "2026-12-29T09:00", plannedEnd: "2027-01-05T09:00" }),
      );
      // Handing over comes in a later slice; until then the test moves the rental on itself.
      await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .update(rentals)
          .set({ status: "active", handedOverAt: new Date("2026-12-01T01:00:00Z") })
          .where(eq(rentals.id, late)),
      );
      const dayAfterEnd: RentalClock = { ...CLOCK, now: new Date("2026-12-30T01:00:00Z") };

      const page = await listRentalPage(web.db, actor.operatorId, rentalQuery(), {
        clock: dayAfterEnd,
        scope: { vehicleId },
      });

      expect(page.rows.map(({ id, isOverdue, isAtRisk }) => ({ id, isOverdue, isAtRisk }))).toEqual(
        [
          { id: late, isOverdue: true, isAtRisk: false },
          { id: next, isOverdue: false, isAtRisk: true },
        ],
      );
    });

    it("shows no other Operator's rental, by list or by id", async () => {
      const rentalId = savedId(await book(await addTestCar(web, actor)));

      const theirList = await listRentalPage(web.db, otherActor.operatorId, rentalQuery(), {
        clock: CLOCK,
      });

      expect(theirList.rows.map((row) => row.id)).not.toContain(rentalId);
      expect(await loadRental(web.db, otherActor.operatorId, rentalId, CLOCK)).toBeNull();
    });

    it("puts held cars on the calendar, but not cancelled ones", async () => {
      const vehicleId = await addTestCar(web, actor);
      const kept = savedId(await book(vehicleId));
      const cancelled = savedId(
        await book(vehicleId, { plannedStart: "2027-01-05T09:00", plannedEnd: "2027-01-12T09:00" }),
      );
      await cancelRental(web.db, actor, cancelled, { reason: "No longer needed" }, CLOCK.now);

      const bookings = await listCalendarBookings(web.db, actor.operatorId, {
        from: new Date("2026-11-01T00:00:00Z"),
        to: new Date("2027-02-01T00:00:00Z"),
        vehicleId,
      });

      expect(bookings).toEqual([
        expect.objectContaining({
          rentalId: kept,
          heldFrom: new Date("2026-12-01T01:00:00Z"),
          heldUntil: new Date("2026-12-29T01:00:00Z"),
        }),
      ]);
    });
  });
});
