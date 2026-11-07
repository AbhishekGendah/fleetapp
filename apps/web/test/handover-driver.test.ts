import { organisationDrivers, rentals, renters } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import {
  HandoverRefusedError,
  lockPartiesForHandover,
} from "../src/lib/handover/complete-handover";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";

/**
 * The handover hands the car to the driver the rental names under its lock,
 * never one read before (slice 1 review F5): a driver changed meanwhile gets
 * the friendly "changed" refusal rather than a database error.
 */
describe("the handover's driver, read under the rental's lock", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;

  /** A business's booking naming the first of its two drivers (written straight in: slice 3 adds the screens). */
  async function businessBooking() {
    const vehicleId = await addTestCar(web, actor);
    return withTenant(web.db, actor.operatorId, async (tx) => {
      const [business] = await tx
        .insert(renters)
        .values({
          operatorId: actor.operatorId,
          kind: "organisation",
          fullName: "Acme Rideshare Pty Ltd",
          email: "accounts@acme.example.test",
        })
        .returning({ id: renters.id });
      const drivers = await tx
        .insert(renters)
        .values([
          { operatorId: actor.operatorId, fullName: "Sam Driver", phone: "0412345678" },
          { operatorId: actor.operatorId, fullName: "Lee Driver", phone: "0412345679" },
        ])
        .returning({ id: renters.id });
      await tx.insert(organisationDrivers).values(
        drivers.map((driver) => ({
          operatorId: actor.operatorId,
          organisationId: business!.id,
          driverId: driver.id,
          addedByUserId: actor.userId,
        })),
      );
      const [rental] = await tx
        .insert(rentals)
        .values({
          operatorId: actor.operatorId,
          renterId: business!.id,
          driverId: drivers[0]!.id,
          vehicleId,
          type: "fixed_term",
          status: "booked",
          plannedStart: new Date("2027-06-01T01:00:00Z"),
          plannedEnd: new Date("2027-06-29T01:00:00Z"),
          chargeWeekday: 2,
          bondCents: 0,
          settingsSnapshot: {},
          settingsVersion: 1,
        })
        .returning({ id: rentals.id });
      return {
        rentalId: rental!.id,
        renterId: business!.id,
        firstDriverId: drivers[0]!.id,
        secondDriverId: drivers[1]!.id,
      };
    });
  }

  const lockFor = (view: { rentalId: string; renterId: string; driverId: string | null }) =>
    withTenant(web.db, actor.operatorId, (tx) =>
      lockPartiesForHandover(tx, actor.operatorId, view),
    );

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Handover Driver Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("hands the car to the driver the rental still names", async () => {
    const booking = await businessBooking();
    expect(await lockFor({ ...booking, driverId: booking.firstDriverId })).toBe(
      booking.firstDriverId,
    );
  });

  it("refuses, as changed, when the rental names another driver since the page was read", async () => {
    const booking = await businessBooking();
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .update(rentals)
        .set({ driverId: booking.secondDriverId })
        .where(eq(rentals.id, booking.rentalId)),
    );

    const refusal = await lockFor({ ...booking, driverId: booking.firstDriverId }).catch(
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(HandoverRefusedError);
    expect((refusal as HandoverRefusedError).result).toEqual({ status: "renter_changed" });
  });
});
