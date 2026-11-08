import { carHolds, possessions, rentals } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { bookingFailure } from "../src/app/rentals/booking-failure";
import type { ActingUser } from "../src/lib/acting-user";
import { findNewHoldClash, heldRange, isCarAlreadyHeld } from "../src/lib/rentals/car-holds";
import { changeRentalEnd } from "../src/lib/rentals/rental-changes";
import { bookRental, cancelRental } from "../src/lib/rentals/rental-records";
import { addCurrentPaperwork, addTestCar, seedOperatorWithUser } from "./car-fixtures";
import {
  addTestRenter,
  attemptTestBooking,
  bookTestRentalOn,
  recordTestHandover,
  TEST_TIME_ZONE,
} from "./rental-fixtures";

/**
 * A car still out past its return date is not free until it is back
 * (docs/plans/find-a-car.md, decision 5): refused by the booking code and,
 * underneath it, by the database (migration 0054), whose clock is the real
 * one. So the late rental's dates are in the past for good: out from Tue 6
 * Oct 2026, due back 10am Perth on Tue 3 Nov 2026, never returned.
 */
const LATE_PERIOD = { plannedStart: "2026-10-06T10:00", plannedEnd: "2026-11-03T10:00" };
const DUE_BACK = new Date("2026-11-03T02:00:00Z");
const HANDED_OVER = new Date("2026-10-06T02:00:00Z");
const BOOKED_ON = new Date("2026-10-01T00:00:00Z");
/** The week from the old return time: free by the hold alone, as the form used to find. */
const FROM_DUE_BACK = { plannedStart: "2026-11-03T10:00", plannedEnd: "2026-11-10T10:00" };
const FAR_AHEAD = { plannedStart: "2034-06-01T09:00", plannedEnd: "2034-06-29T09:00" };
/** A rental out now and due back long after any run of this test. */
const NOT_YET_DUE = { plannedStart: "2026-10-06T10:00", plannedEnd: "2035-01-02T10:00" };
const AFTER_NOT_YET_DUE = { plannedStart: "2035-01-02T10:00", plannedEnd: "2035-01-09T10:00" };
const STILL_OUT_MESSAGE =
  "This car is still out: it was due back 3 Nov 2026, 10:00 am AWST and hasn't been returned yet. Choose another car, or record its return first.";
const EXCLUSION_VIOLATION = "23P01";
const FOREIGN_KEY_VIOLATION = "23503";

function postgresCodeOf(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code ?? (error as { code?: string }).code;
}

describe("a car still out past its return date", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: TestConnection;
  let actor: ActingUser;
  let otherOperator: ActingUser;

  /** A car with rego and insurance, and a Renter to book it for. */
  async function carAndRenter(owner: ActingUser): Promise<{ vehicleId: string; renterId: string }> {
    const vehicleId = await addTestCar(web, owner);
    await addCurrentPaperwork(web, owner, vehicleId);
    return { vehicleId, renterId: await addTestRenter(web, owner) };
  }

  /** A car handed over for `period` and never returned; later bookings, if any, made before. */
  async function carOut(
    owner: ActingUser,
    options: {
      period?: { plannedStart: string; plannedEnd: string | null };
      bookedBefore?: (typeof FROM_DUE_BACK)[];
    } = {},
  ) {
    const parties = await carAndRenter(owner);
    const out = await bookTestRentalOn(web, owner, {
      ...parties,
      period: options.period ?? LATE_PERIOD,
      now: BOOKED_ON,
    });
    const later = [];
    for (const period of options.bookedBefore ?? []) {
      later.push(await bookTestRentalOn(web, owner, { ...parties, period, now: BOOKED_ON }));
    }
    await recordTestHandover(superuser, out.rentalId, HANDED_OVER);
    return { ...parties, lateRentalId: out.rentalId, laterRentalIds: later.map((r) => r.rentalId) };
  }

  /** A draft on the car: a rental with no hold, to hold the car for straight in the database. */
  async function draftOn(owner: ActingUser, vehicleId: string, renterId: string): Promise<string> {
    const draft = await bookTestRentalOn(web, owner, {
      vehicleId,
      renterId,
      period: FAR_AHEAD,
      status: "draft",
    });
    return draft.rentalId;
  }

  function holdStraightIn(
    owner: ActingUser,
    hold: { vehicleId: string; rentalId: string; start: Date; end: Date | null },
  ): Promise<unknown> {
    return withTenant(web.db, owner.operatorId, (tx) =>
      tx.insert(carHolds).values({
        operatorId: owner.operatorId,
        vehicleId: hold.vehicleId,
        rentalId: hold.rentalId,
        heldDuring: heldRange(hold.start, hold.end),
      }),
    );
  }

  async function returnCar(rentalId: string): Promise<void> {
    await superuser.db
      .update(possessions)
      .set({ endedAt: new Date() })
      .where(and(eq(possessions.rentalId, rentalId), isNull(possessions.endedAt)));
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    actor = await seedOperatorWithUser(admin, "Late Car Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Late Car Rentals Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.close()]);
  });

  describe("the New rental form", () => {
    it("refuses the week from the old return time, saying when it was due back", async () => {
      const car = await carOut(actor);

      const result = await attemptTestBooking(web, actor, { ...car, period: FROM_DUE_BACK });

      expect(result).toEqual({
        status: "car_taken",
        clash: { kind: "still_out", rentalId: car.lateRentalId, dueBack: DUE_BACK },
      });
      expect(bookingFailure(result, TEST_TIME_ZONE)).toMatchObject({
        formError: STILL_OUT_MESSAGE,
        link: { label: "See that rental" },
      });
    });

    it("refuses dates long after, and an ongoing booking, as nobody knows when it is back", async () => {
      const car = await carOut(actor);

      const farAhead = await attemptTestBooking(web, actor, { ...car, period: FAR_AHEAD });
      const ongoing = await attemptTestBooking(web, actor, {
        ...car,
        period: { plannedStart: FAR_AHEAD.plannedStart, plannedEnd: null },
      });

      expect(farAhead).toMatchObject({ status: "car_taken", clash: { kind: "still_out" } });
      expect(ongoing).toMatchObject({ status: "car_taken", clash: { kind: "still_out" } });
    });

    it("says it is still out, not just booked, for dates starting before it was due back", async () => {
      const car = await carOut(actor);

      const result = await attemptTestBooking(web, actor, {
        ...car,
        period: { plannedStart: "2026-11-01T10:00", plannedEnd: "2026-11-08T10:00" },
      });

      expect(result).toMatchObject({ status: "car_taken", clash: { kind: "still_out" } });
    });

    it("refuses turning a draft on the car into a booking", async () => {
      const car = await carOut(actor);
      const draftId = await draftOn(actor, car.vehicleId, car.renterId);

      const result = await bookRental(web.db, actor, draftId, {
        timeZone: TEST_TIME_ZONE,
        now: new Date(),
      });

      expect(result).toMatchObject({ status: "car_taken", clash: { kind: "still_out" } });
    });

    it("books the car again once it is back", async () => {
      const car = await carOut(actor);
      await returnCar(car.lateRentalId);

      const result = await attemptTestBooking(web, actor, { ...car, period: FROM_DUE_BACK });

      expect(result.status).toBe("saved");
    });

    it("books the car from its return time while it is not yet late, as before", async () => {
      const car = await carOut(actor, { period: NOT_YET_DUE });

      const result = await attemptTestBooking(web, actor, { ...car, period: AFTER_NOT_YET_DUE });

      expect(result.status).toBe("saved");
    });

    it("leaves an ongoing rental's car to its own open-ended hold", async () => {
      const car = await carOut(actor, {
        period: { plannedStart: LATE_PERIOD.plannedStart, plannedEnd: null },
      });

      const result = await attemptTestBooking(web, actor, { ...car, period: FAR_AHEAD });

      expect(result).toMatchObject({
        status: "car_taken",
        clash: { rentalId: car.lateRentalId, plannedEnd: null },
      });
      expect(result).not.toMatchObject({ clash: { kind: "still_out" } });
    });
  });

  describe("the late rental and bookings already made", () => {
    it("lets the late rental itself be given a new end", async () => {
      const car = await carOut(actor);

      const result = await changeRentalEnd(
        web.db,
        actor,
        car.lateRentalId,
        { newEnd: new Date("2034-01-03T02:00:00Z"), reason: "Renter is keeping it longer" },
        { timeZone: TEST_TIME_ZONE, now: new Date() },
      );

      expect(result.status).toBe("changed");
    });

    it("keeps a booking made before the car was late, which can still move or be cancelled", async () => {
      const car = await carOut(actor, { bookedBefore: [FROM_DUE_BACK] });
      const nextId = car.laterRentalIds[0]!;

      const moved = await changeRentalEnd(
        web.db,
        actor,
        nextId,
        { newEnd: new Date("2034-01-10T02:00:00Z"), reason: "Renter wants it longer" },
        { timeZone: TEST_TIME_ZONE, now: new Date() },
      );
      const pushedBack = withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .update(carHolds)
          .set({ heldDuring: heldRange(new Date("2034-01-03T02:00:00Z"), null) })
          .where(and(eq(carHolds.rentalId, nextId), isNull(carHolds.releasedAt))),
      );

      expect(moved.status).toBe("changed");
      await expect(pushedBack).resolves.toBeDefined();
      expect(
        await cancelRental(web.db, actor, nextId, { reason: "Car not back" }, new Date()),
      ).toBe("cancelled");
    });
  });

  describe("the database's own rule", () => {
    it("refuses a hold reaching past the planned end, even written straight in", async () => {
      const car = await carOut(actor);
      const draftId = await draftOn(actor, car.vehicleId, car.renterId);

      const caught = await holdStraightIn(actor, {
        vehicleId: car.vehicleId,
        rentalId: draftId,
        start: new Date("2034-06-01T01:00:00Z"),
        end: new Date("2034-06-08T01:00:00Z"),
      }).catch((error: unknown) => error);

      expect(postgresCodeOf(caught)).toBe(EXCLUSION_VIOLATION);
      expect(isCarAlreadyHeld(caught)).toBe(true);
    });

    it("refuses a hold from the planned end and an open-ended one", async () => {
      const car = await carOut(actor);
      const draftId = await draftOn(actor, car.vehicleId, car.renterId);

      const fromDueBack = holdStraightIn(actor, {
        vehicleId: car.vehicleId,
        rentalId: draftId,
        start: DUE_BACK,
        end: new Date("2026-11-10T02:00:00Z"),
      });
      const openEnded = holdStraightIn(actor, {
        vehicleId: car.vehicleId,
        rentalId: draftId,
        start: new Date("2034-06-01T01:00:00Z"),
        end: null,
      });

      await expect(fromDueBack).rejects.toSatisfy(isCarAlreadyHeld);
      await expect(openEnded).rejects.toSatisfy(isCarAlreadyHeld);
    });

    it("refuses moving a hold that ended before the planned end into the time after it", async () => {
      const car = await carOut(actor);
      const draftId = await draftOn(actor, car.vehicleId, car.renterId);
      // Before the late rental's own hold: allowed, as any past booking would be.
      await holdStraightIn(actor, {
        vehicleId: car.vehicleId,
        rentalId: draftId,
        start: new Date("2026-09-01T02:00:00Z"),
        end: new Date("2026-09-08T02:00:00Z"),
      });

      const moved = withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .update(carHolds)
          .set({ heldDuring: heldRange(new Date("2034-06-01T01:00:00Z"), null) })
          .where(eq(carHolds.rentalId, draftId)),
      );

      await expect(moved).rejects.toSatisfy(isCarAlreadyHeld);
    });

    it("lets the late rental's own hold move, and let go at the return", async () => {
      const car = await carOut(actor);

      const ownHold = (changes: Partial<typeof carHolds.$inferInsert>) =>
        withTenant(web.db, actor.operatorId, (tx) =>
          tx
            .update(carHolds)
            .set(changes)
            .where(and(eq(carHolds.rentalId, car.lateRentalId), isNull(carHolds.releasedAt)))
            .returning({ id: carHolds.id }),
        );

      expect(await ownHold({ heldDuring: heldRange(HANDED_OVER, null) })).toHaveLength(1);
      expect(await ownHold({ releasedAt: new Date() })).toHaveLength(1);
    });

    it("allows the hold once the car is back", async () => {
      const car = await carOut(actor);
      const draftId = await draftOn(actor, car.vehicleId, car.renterId);
      await returnCar(car.lateRentalId);

      await expect(
        holdStraightIn(actor, {
          vehicleId: car.vehicleId,
          rentalId: draftId,
          start: DUE_BACK,
          end: null,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("kept to its Operator", () => {
    it("tells another Operator nothing about the late car, and holds none of its cars", async () => {
      const car = await carOut(otherOperator);
      const mine = await carAndRenter(actor);
      const myDraftId = await draftOn(actor, mine.vehicleId, mine.renterId);

      const seen = await withTenant(web.db, actor.operatorId, (tx) =>
        findNewHoldClash(
          tx,
          actor.operatorId,
          car.vehicleId,
          { start: DUE_BACK, end: null },
          new Date(),
        ),
      );
      const caught = await holdStraightIn(actor, {
        vehicleId: car.vehicleId,
        rentalId: myDraftId,
        start: DUE_BACK,
        end: null,
      }).catch((error: unknown) => error);
      const myOwnCar = await attemptTestBooking(web, actor, { ...mine, period: FROM_DUE_BACK });

      expect(seen).toBeNull();
      // Refused as a car that isn't this Operator's, not as a late car.
      expect(postgresCodeOf(caught)).toBe(FOREIGN_KEY_VIOLATION);
      expect(myOwnCar.status).toBe("saved");
      const [late] = await withTenant(web.db, otherOperator.operatorId, (tx) =>
        tx.select({ status: rentals.status }).from(rentals).where(eq(rentals.id, car.lateRentalId)),
      );
      expect(late?.status).toBe("active");
    });
  });
});
