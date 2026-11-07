import { DEFAULT_HANDOVER_PHOTOS } from "@fleetapp/core";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  addTestCar,
  addTestRenter,
  connectAs,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";

const CHECK_VIOLATION = "23514";
const RESTRICT_VIOLATION = "23001";
/** A wait that never ends fails the test quickly rather than hanging it. */
const LOCK_TIMEOUT = "5s";
const POLL_MS = 20;
const POLL_ATTEMPTS = 250;

/**
 * Two transactions at once on the same Renter, rental or link (slice 1
 * review F4): the second waits for the first, then sees what it did. Each
 * test holds the first open, waits until the database shows the second
 * waiting on a lock, then ends the first, so the order is fixed.
 */
describe("business Renters with two transactions at once", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let superuser: Client;
  let first: Client;
  let second: Client;
  let operatorId: string;
  let userId: string;

  async function begin(client: Client): Promise<void> {
    await client.query("begin");
    await client.query("select set_config('app.operator_id', $1, true)", [operatorId]);
  }

  async function pidOf(client: Client): Promise<number> {
    const result = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
    return result.rows[0]!.pid;
  }

  /** Resolves once the given connection is waiting on a lock. */
  async function waitUntilBlocked(client: Client): Promise<void> {
    const pid = pids.get(client);
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      const result = await superuser.query<{ wait: string | null }>(
        "select wait_event_type as wait from pg_stat_activity where pid = $1",
        [pid],
      );
      if (result.rows[0]?.wait === "Lock") {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error("The second transaction never waited for the first.");
  }

  const pids = new Map<Client, number>();

  /** The SQLSTATE a query failed with, or undefined if it worked. */
  async function codeOf(query: Promise<unknown>): Promise<string | undefined> {
    try {
      await query;
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  }

  async function addBusiness(): Promise<string> {
    return withTenant(web.db, operatorId, async (tx) => {
      const [row] = await tx
        .insert(schema.renters)
        .values({
          operatorId,
          kind: "organisation",
          fullName: "Acme Rideshare Pty Ltd",
          email: "accounts@acme.example.test",
        })
        .returning({ id: schema.renters.id });
      return row!.id;
    });
  }

  async function link(organisationId: string, driverId: string): Promise<string> {
    return withTenant(web.db, operatorId, async (tx) => {
      const [row] = await tx
        .insert(schema.organisationDrivers)
        .values({ operatorId, organisationId, driverId, addedByUserId: userId })
        .returning({ id: schema.organisationDrivers.id });
      return row!.id;
    });
  }

  /** A business with two current drivers and a booking naming the first. */
  async function bookingWithTwoDrivers() {
    const businessId = await addBusiness();
    const firstDriverId = await addTestRenter(web.db, operatorId);
    const secondDriverId = await addTestRenter(web.db, operatorId);
    await link(businessId, firstDriverId);
    await link(businessId, secondDriverId);
    const vehicleId = await addTestCar(web.db, operatorId);
    const rentalId = await withTenant(web.db, operatorId, async (tx) => {
      const [rental] = await tx
        .insert(schema.rentals)
        .values(rentalRow(businessId, firstDriverId, vehicleId))
        .returning({ id: schema.rentals.id });
      const inspectionValues = {
        operatorId,
        rentalId: rental!.id,
        vehicleId,
        kind: "handover" as const,
        photoNames: [...DEFAULT_HANDOVER_PHOTOS],
        startedByUserId: userId,
      };
      await tx.insert(schema.inspections).values(inspectionValues);
      return rental!.id;
    });
    const [inspection] = await withTenant(web.db, operatorId, (tx) =>
      tx
        .select({ id: schema.inspections.id })
        .from(schema.inspections)
        .where(eq(schema.inspections.rentalId, rentalId)),
    );
    return {
      businessId,
      firstDriverId,
      secondDriverId,
      vehicleId,
      rentalId,
      inspectionId: inspection!.id,
    };
  }

  function rentalRow(renterId: string, driverId: string, vehicleId: string) {
    return {
      operatorId,
      renterId,
      driverId,
      vehicleId,
      type: "fixed_term" as const,
      status: "booked" as const,
      plannedStart: new Date("2027-03-01T01:00:00Z"),
      plannedEnd: new Date("2027-03-29T01:00:00Z"),
      chargeWeekday: 1,
      bondCents: 0,
      settingsSnapshot: {},
      settingsVersion: 1,
    };
  }

  const insertPossession = (
    client: Client,
    booking: Awaited<ReturnType<typeof bookingWithTwoDrivers>>,
  ) =>
    client.query(
      `insert into possessions (operator_id, rental_id, vehicle_id, renter_id, started_at, handover_inspection_id)
       values ($1, $2, $3, $4, now(), $5)`,
      [operatorId, booking.rentalId, booking.vehicleId, booking.businessId, booking.inspectionId],
    );

  const insertLink = (client: Client, organisationId: string, driverId: string) =>
    client.query(
      `insert into organisation_drivers (operator_id, organisation_id, driver_id, added_by_user_id)
       values ($1, $2, $3, $4)`,
      [operatorId, organisationId, driverId, userId],
    );

  const removeLink = (client: Client, linkId: string) =>
    client.query(
      `update organisation_drivers set removed_at = now(), removed_by_user_id = $2 where id = $1`,
      [linkId, userId],
    );

  const nameDriver = (
    client: Client,
    organisationId: string,
    driverId: string,
    vehicleId: string,
  ) =>
    client.query(
      `insert into rentals (operator_id, renter_id, driver_id, vehicle_id, type, status, planned_start,
         planned_end, charge_weekday, bond_cents, settings_snapshot, settings_version)
       values ($1, $2, $3, $4, 'fixed_term', 'booked', '2027-05-01T01:00:00Z', '2027-05-29T01:00:00Z',
         1, 0, '{}', 1)`,
      [operatorId, organisationId, driverId, vehicleId],
    );

  /** A person whose seven years are up (dated back with the app's triggers off). */
  async function agedPerson(): Promise<string> {
    const renterId = await addTestRenter(web.db, operatorId);
    await superuser.query("begin");
    await superuser.query("set local session_replication_role = replica");
    await superuser.query(
      "update renters set created_at = now() - interval '8 years' where id = $1",
      [renterId],
    );
    await superuser.query("commit");
    return renterId;
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    ({ operatorAId: operatorId } = await seedTwoOperators(admin.db));
    const [user] = await admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.operatorId, operatorId));
    userId = user!.id;
    first = new Client({ connectionString: inject("webRoleUrl") });
    second = new Client({ connectionString: inject("webRoleUrl") });
    await Promise.all([first.connect(), second.connect()]);
    for (const client of [first, second]) {
      await client.query(`set lock_timeout = '${LOCK_TIMEOUT}'`);
      pids.set(client, await pidOf(client));
    }
  });

  beforeEach(async () => {
    // Nothing left open by a test that failed half-way.
    await Promise.all([first.query("rollback"), second.query("rollback")]);
  });

  afterAll(async () => {
    await Promise.all([first.end(), second.end(), superuser.end(), web.close(), admin.close()]);
  });

  describe("a driver link and the retention job", () => {
    it("a link waits for a retirement under way, then is refused", async () => {
      const businessId = await addBusiness();
      const driverId = await agedPerson();
      await begin(first);
      const retired = await first.query<{ retired: boolean }>(
        "select app.retire_renter($1) as retired",
        [driverId],
      );
      await begin(second);
      const linking = codeOf(insertLink(second, businessId, driverId));
      await waitUntilBlocked(second);
      await first.query("commit");

      expect(retired.rows[0]?.retired).toBe(true);
      expect(await linking).toBe(RESTRICT_VIOLATION);
      await second.query("rollback");
    });

    it("a retirement waits for a link being added, then keeps the driver", async () => {
      const businessId = await addBusiness();
      const driverId = await agedPerson();
      await begin(second);
      await insertLink(second, businessId, driverId);
      await begin(first);
      const retiring = first.query<{ retired: boolean }>(
        "select app.retire_renter($1) as retired",
        [driverId],
      );
      await waitUntilBlocked(first);
      await second.query("commit");

      expect((await retiring).rows[0]?.retired).toBe(false);
      await first.query("commit");
    });
  });

  describe("a car going out and its driver changing", () => {
    it("a driver change waits for the possession starting, then is refused", async () => {
      const booking = await bookingWithTwoDrivers();
      await begin(first);
      await insertPossession(first, booking);
      await begin(second);
      const changing = codeOf(
        second.query("update rentals set driver_id = $2 where id = $1", [
          booking.rentalId,
          booking.secondDriverId,
        ]),
      );
      await waitUntilBlocked(second);
      await first.query("commit");

      expect(await changing).toBe(CHECK_VIOLATION);
      await second.query("rollback");
    });

    it("a possession waits for a driver change, then goes to the new driver", async () => {
      const booking = await bookingWithTwoDrivers();
      await begin(second);
      await second.query("update rentals set driver_id = $2 where id = $1", [
        booking.rentalId,
        booking.secondDriverId,
      ]);
      await begin(first);
      const starting = insertPossession(first, booking);
      await waitUntilBlocked(first);
      await second.query("commit");
      await starting;
      await first.query("commit");

      const [possession] = await withTenant(web.db, operatorId, (tx) =>
        tx
          .select({ driverId: schema.possessions.driverId })
          .from(schema.possessions)
          .where(eq(schema.possessions.rentalId, booking.rentalId)),
      );
      expect(possession?.driverId).toBe(booking.secondDriverId);
    });
  });

  describe("naming a driver and removing their link", () => {
    it("a removal waits for the driver being named, then is refused", async () => {
      const businessId = await addBusiness();
      const driverId = await addTestRenter(web.db, operatorId);
      const linkId = await link(businessId, driverId);
      const vehicleId = await addTestCar(web.db, operatorId);
      await begin(first);
      await nameDriver(first, businessId, driverId, vehicleId);
      await begin(second);
      const removing = codeOf(removeLink(second, linkId));
      await waitUntilBlocked(second);
      await first.query("commit");

      expect(await removing).toBe(RESTRICT_VIOLATION);
      await second.query("rollback");
    });

    it("naming waits for the link being removed, then is refused", async () => {
      const businessId = await addBusiness();
      const driverId = await addTestRenter(web.db, operatorId);
      const linkId = await link(businessId, driverId);
      const vehicleId = await addTestCar(web.db, operatorId);
      await begin(second);
      await removeLink(second, linkId);
      await begin(first);
      const naming = codeOf(nameDriver(first, businessId, driverId, vehicleId));
      await waitUntilBlocked(first);
      await second.query("commit");

      expect(await naming).toBe(CHECK_VIOLATION);
      await first.query("rollback");
    });
  });
});
