import { DEFAULT_HANDOVER_PHOTOS, isValidAbn } from "@fleetapp/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { AnyTransaction } from "../src/client";
import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  addTestCar,
  addTestRenter,
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  testRentalRow,
  type TestConnection,
} from "./fixtures";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
/** Passes the ATO's checksum (the ATO's own published example). */
const VALID_ABN = "51824753556";
const HOUR_MS = 60 * 60 * 1000;

type RentalInsert = typeof schema.rentals.$inferInsert;

/**
 * Business Renters and their drivers (docs/plans/business-renters.md,
 * Migration A): a Renter's kind, a business's details, who drives for whom,
 * and who drives each rental and had each car, all held by the database and
 * kept to their Operator.
 */
describe("business Renters and their drivers", () => {
  let web: TestConnection;
  let admin: TestConnection;
  /** Only to put records in states no app role can (retired, dated back). */
  let superuser: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let userAId: string;
  let userBId: string;

  async function userOf(operatorId: string): Promise<string> {
    const [user] = await admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.operatorId, operatorId));
    return user!.id;
  }

  function addBusiness(
    operatorId: string,
    changes: Partial<typeof schema.renters.$inferInsert> = {},
  ): Promise<string> {
    return withTenant(web.db, operatorId, async (tx) => {
      const [row] = await tx
        .insert(schema.renters)
        .values({
          operatorId,
          kind: "organisation",
          fullName: "Acme Rideshare Pty Ltd",
          tradingName: "Acme",
          abn: VALID_ABN,
          contactName: "Pat Contact",
          email: "accounts@acme.example.test",
          ...changes,
        })
        .returning({ id: schema.renters.id });
      return row!.id;
    });
  }

  function linkDriver(operatorId: string, organisationId: string, driverId: string) {
    return withTenant(web.db, operatorId, async (tx) => {
      const [row] = await tx
        .insert(schema.organisationDrivers)
        .values({
          operatorId,
          organisationId,
          driverId,
          addedByUserId: operatorId === operatorAId ? userAId : userBId,
        })
        .returning({ id: schema.organisationDrivers.id });
      return row!.id;
    });
  }

  function removeLink(linkId: string) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.organisationDrivers)
        .set({ removedAt: new Date(), removedByUserId: userAId })
        .where(eq(schema.organisationDrivers.id, linkId)),
    );
  }

  async function addRental(
    parties: { renterId: string; driverId?: string | null },
    changes: Partial<RentalInsert> = {},
  ): Promise<{ rentalId: string; vehicleId: string }> {
    const vehicleId = await addTestCar(web.db, operatorAId);
    const [rental] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.rentals)
        .values(
          testRentalRow(
            { operatorId: operatorAId, renterId: parties.renterId, vehicleId },
            { driverId: parties.driverId, ...changes },
          ),
        )
        .returning({ id: schema.rentals.id }),
    );
    return { rentalId: rental!.id, vehicleId };
  }

  const rentalDriverOf = async (rentalId: string): Promise<string | null> => {
    const [row] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .select({ driverId: schema.rentals.driverId })
        .from(schema.rentals)
        .where(eq(schema.rentals.id, rentalId)),
    );
    return row!.driverId;
  };

  function setDriver(rentalId: string, driverId: string | null) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx.update(schema.rentals).set({ driverId }).where(eq(schema.rentals.id, rentalId)),
    );
  }

  async function addHandoverInspection(rental: { rentalId: string; vehicleId: string }) {
    const [inspection] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.inspections)
        .values({
          operatorId: operatorAId,
          ...rental,
          kind: "handover",
          photoNames: [...DEFAULT_HANDOVER_PHOTOS],
          startedByUserId: userAId,
        })
        .returning({ id: schema.inspections.id }),
    );
    return inspection!.id;
  }

  /** A car out under a possession, as old code writes it: no driver named. */
  async function handOver(
    tx: AnyTransaction,
    rental: { rentalId: string; vehicleId: string; renterId: string },
    inspectionId: string,
    possession: { startedAt: Date; driverId?: string },
  ) {
    const [row] = await tx
      .insert(schema.possessions)
      .values({
        operatorId: operatorAId,
        rentalId: rental.rentalId,
        vehicleId: rental.vehicleId,
        renterId: rental.renterId,
        // Old deployed code names no driver: the database fills it in.
        driverId: possession.driverId as string,
        startedAt: possession.startedAt,
        handoverInspectionId: inspectionId,
      })
      .returning();
    return row!;
  }

  /** A booked rental of a car handed over now, in one transaction, with its possession. */
  async function rentalOut(renterId: string, driverId?: string) {
    const rental = await addRental({ renterId, driverId });
    const inspectionId = await addHandoverInspection(rental);
    const startedAt = new Date(Date.now() - HOUR_MS);
    const possession = await withTenant(web.db, operatorAId, async (tx) => {
      await tx
        .update(schema.rentals)
        .set({ status: "active", handedOverAt: startedAt })
        .where(eq(schema.rentals.id, rental.rentalId));
      return handOver(tx, { ...rental, renterId }, inspectionId, { startedAt });
    });
    return { ...rental, renterId, inspectionId, possession };
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    [userAId, userBId] = await Promise.all([userOf(operatorAId), userOf(operatorBId)]);
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close(), superuser.close()]);
  });

  describe("a Renter's kind and a business's details", () => {
    it("makes every Renter a person unless said otherwise", async () => {
      const renterId = await addTestRenter(web.db, operatorAId);
      const [row] = await withTenant(web.db, operatorAId, (tx) =>
        tx.select().from(schema.renters).where(eq(schema.renters.id, renterId)),
      );
      expect(row?.kind).toBe("person");
    });

    it("never lets the app change a Renter's kind", async () => {
      const renterId = await addTestRenter(web.db, operatorAId);
      const code = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx
            .update(schema.renters)
            .set({ kind: "organisation" })
            .where(eq(schema.renters.id, renterId)),
        ),
      );
      expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    });

    it("lets the app edit a business's own details", async () => {
      const businessId = await addBusiness(operatorAId);
      await withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.renters)
          .set({ tradingName: "Acme Cars", contactName: "Lee Contact", businessAddress: "1 St" })
          .where(eq(schema.renters.id, businessId)),
      );
      const [row] = await withTenant(web.db, operatorAId, (tx) =>
        tx.select().from(schema.renters).where(eq(schema.renters.id, businessId)),
      );
      expect(row).toMatchObject({ tradingName: "Acme Cars", contactName: "Lee Contact" });
    });

    it("accepts a valid ABN and refuses a bad checksum or shape, on a business or a person", async () => {
      const valid = await addBusiness(operatorAId);
      const codes = await Promise.all([
        postgresErrorCodeOf(addBusiness(operatorAId, { abn: "51824753557" })),
        postgresErrorCodeOf(addBusiness(operatorAId, { abn: "51 824 753 556" })),
        postgresErrorCodeOf(addBusiness(operatorAId, { abn: "5182475355" })),
        postgresErrorCodeOf(
          withTenant(web.db, operatorAId, (tx) =>
            tx.insert(schema.renters).values({
              operatorId: operatorAId,
              fullName: "Sole Trader",
              phone: "0400 000 000",
              abn: "15824753556",
            }),
          ),
        ),
      ]);
      expect(valid).toEqual(expect.any(String));
      expect(codes).toEqual([CHECK_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION]);
    });

    it("checks an ABN the same way as the app does", async () => {
      const samples = [VALID_ABN, "53004085616", "51824753557", "15824753556", "00000000000"];
      const result = await admin.db.execute<{ abn: string; is_valid: boolean }>(sql`
        select abn, app.is_valid_abn(abn) as is_valid
        from unnest(${sql.raw(`ARRAY[${samples.map((abn) => `'${abn}'`).join(", ")}]`)}) as abn
      `);
      expect(result.rows.map((row) => row.is_valid)).toEqual(
        result.rows.map((row) => isValidAbn(row.abn)),
      );
      expect(result.rows.filter((row) => row.is_valid).length).toBeGreaterThanOrEqual(2);
    });

    it("refuses a business with no email (Abhi, 7 Nov 2026)", async () => {
      const code = await postgresErrorCodeOf(
        addBusiness(operatorAId, { email: null, phone: "0400 000 000" }),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });

    it("refuses a licence or date of birth on a business, and a trading name on a person", async () => {
      const codes = await Promise.all([
        postgresErrorCodeOf(addBusiness(operatorAId, { dateOfBirth: "1990-01-01" })),
        postgresErrorCodeOf(
          addBusiness(operatorAId, {
            licenceIssuedIn: "WA",
            licenceNumber: "1234567",
            licenceClass: "C",
            licenceType: "full",
            licenceExpiresOn: "2030-01-01",
          }),
        ),
        postgresErrorCodeOf(
          withTenant(web.db, operatorAId, (tx) =>
            tx.insert(schema.renters).values({
              operatorId: operatorAId,
              fullName: "Sam Person",
              email: "sam@example.test",
              tradingName: "Sam's Cars",
            }),
          ),
        ),
      ]);
      expect(codes).toEqual([CHECK_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION]);
    });
  });

  describe("who drives for whom", () => {
    it("links a person to a business, once at a time, keeping the history", async () => {
      const businessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      const linkId = await linkDriver(operatorAId, businessId, driverId);

      const twice = await postgresErrorCodeOf(linkDriver(operatorAId, businessId, driverId));
      await removeLink(linkId);
      const again = await linkDriver(operatorAId, businessId, driverId);

      expect(twice).toBe(UNIQUE_VIOLATION);
      expect(again).not.toBe(linkId);
    });

    it("refuses a business as a driver, a person as the business, and a link to itself", async () => {
      const businessId = await addBusiness(operatorAId);
      const otherBusinessId = await addBusiness(operatorAId);
      const personId = await addTestRenter(web.db, operatorAId);
      const codes = await Promise.all([
        postgresErrorCodeOf(linkDriver(operatorAId, businessId, otherBusinessId)),
        postgresErrorCodeOf(linkDriver(operatorAId, personId, businessId)),
        postgresErrorCodeOf(linkDriver(operatorAId, businessId, businessId)),
      ]);
      expect(codes).toEqual([CHECK_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION]);
    });

    it("keeps a removed link as it is, and never deletes one", async () => {
      const businessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      const linkId = await linkDriver(operatorAId, businessId, driverId);
      await removeLink(linkId);

      const unremoved = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx
            .update(schema.organisationDrivers)
            .set({ removedAt: null, removedByUserId: null })
            .where(eq(schema.organisationDrivers.id, linkId)),
        ),
      );
      const deletedByApp = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.delete(schema.organisationDrivers).where(eq(schema.organisationDrivers.id, linkId)),
        ),
      );
      const deletedBySuperuser = await postgresErrorCodeOf(
        superuser.db
          .delete(schema.organisationDrivers)
          .where(eq(schema.organisationDrivers.id, linkId)),
      );
      expect([unremoved, deletedByApp, deletedBySuperuser]).toEqual([
        POSTGRES_ERROR_CODES.restrictViolation,
        POSTGRES_ERROR_CODES.insufficientPrivilege,
        POSTGRES_ERROR_CODES.restrictViolation,
      ]);
    });

    it("stamps the link's times with the database's clock", async () => {
      const businessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      const longAgo = new Date("2001-01-01T00:00:00Z");
      const [link] = await withTenant(web.db, operatorAId, (tx) =>
        tx
          .insert(schema.organisationDrivers)
          .values({
            operatorId: operatorAId,
            organisationId: businessId,
            driverId,
            addedByUserId: userAId,
            addedAt: longAgo,
          })
          .returning(),
      );
      expect(link!.addedAt.getTime()).toBeGreaterThan(longAgo.getTime());
    });

    it("refuses a retired person as a new driver", async () => {
      const businessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      await markRetired(driverId);
      expect(await postgresErrorCodeOf(linkDriver(operatorAId, businessId, driverId))).toBe(
        POSTGRES_ERROR_CODES.restrictViolation,
      );
    });
  });

  /** Marked retired as the retention job leaves a Renter, with the app's triggers off. */
  async function markRetired(renterId: string): Promise<void> {
    await superuser.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx
        .update(schema.renters)
        .set({ retiredAt: new Date() })
        .where(eq(schema.renters.id, renterId));
    });
  }

  describe("who drives a rental", () => {
    it("fills in a person's own rental's driver, as old code names none", async () => {
      const renterId = await addTestRenter(web.db, operatorAId);
      const { rentalId } = await addRental({ renterId });
      expect(await rentalDriverOf(rentalId)).toBe(renterId);
    });

    it("refuses anyone else as a person's driver, at booking or after", async () => {
      const renterId = await addTestRenter(web.db, operatorAId);
      const otherId = await addTestRenter(web.db, operatorAId);
      const atBooking = await postgresErrorCodeOf(addRental({ renterId, driverId: otherId }));
      const { rentalId } = await addRental({ renterId });
      const after = await postgresErrorCodeOf(setDriver(rentalId, otherId));
      expect([atBooking, after]).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
    });

    it("lets a business book before naming its driver, but no car goes out without one", async () => {
      const businessId = await addBusiness(operatorAId);
      const rental = await addRental({ renterId: businessId });
      const goingOut = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx
            .update(schema.rentals)
            .set({ status: "active", handedOverAt: new Date() })
            .where(eq(schema.rentals.id, rental.rentalId)),
        ),
      );
      const inspectionId = await addHandoverInspection(rental);
      const possession = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          handOver(tx, { ...rental, renterId: businessId }, inspectionId, {
            startedAt: new Date(),
          }),
        ),
      );
      expect(await rentalDriverOf(rental.rentalId)).toBeNull();
      expect([goingOut, possession]).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
    });

    it("names only a current driver of the business, who is a person and not retired", async () => {
      const businessId = await addBusiness(operatorAId);
      const otherBusinessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      const strangerId = await addTestRenter(web.db, operatorAId);
      const formerId = await addTestRenter(web.db, operatorAId);
      const retiredId = await addTestRenter(web.db, operatorAId);
      await linkDriver(operatorAId, businessId, driverId);
      await linkDriver(operatorAId, otherBusinessId, strangerId);
      await removeLink(await linkDriver(operatorAId, businessId, formerId));
      await linkDriver(operatorAId, businessId, retiredId);
      await markRetired(retiredId);

      const { rentalId } = await addRental({ renterId: businessId, driverId });
      const codes = await Promise.all([
        postgresErrorCodeOf(addRental({ renterId: businessId, driverId: strangerId })),
        postgresErrorCodeOf(addRental({ renterId: businessId, driverId: formerId })),
        postgresErrorCodeOf(addRental({ renterId: businessId, driverId: otherBusinessId })),
        postgresErrorCodeOf(addRental({ renterId: businessId, driverId: retiredId })),
      ]);

      expect(await rentalDriverOf(rentalId)).toBe(driverId);
      expect(codes).toEqual([
        CHECK_VIOLATION,
        CHECK_VIOLATION,
        CHECK_VIOLATION,
        POSTGRES_ERROR_CODES.restrictViolation,
      ]);
    });

    it("lets a booking's driver change before the car goes, but not a finished rental's", async () => {
      const businessId = await addBusiness(operatorAId);
      const firstId = await addTestRenter(web.db, operatorAId);
      const secondId = await addTestRenter(web.db, operatorAId);
      await linkDriver(operatorAId, businessId, firstId);
      await linkDriver(operatorAId, businessId, secondId);
      const booked = await addRental({ renterId: businessId, driverId: firstId });
      const cancelled = await addRental(
        { renterId: businessId, driverId: firstId },
        { status: "draft" },
      );
      await withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.rentals)
          .set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: "Test" })
          .where(eq(schema.rentals.id, cancelled.rentalId)),
      );

      await setDriver(booked.rentalId, secondId);
      const finished = await postgresErrorCodeOf(setDriver(cancelled.rentalId, secondId));

      expect(await rentalDriverOf(booked.rentalId)).toBe(secondId);
      expect(finished).toBe(CHECK_VIOLATION);
    });

    it("keeps a rental's driver when the driver later stops driving for the business", async () => {
      const businessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      const linkId = await linkDriver(operatorAId, businessId, driverId);
      const { rentalId } = await addRental({ renterId: businessId, driverId });
      await removeLink(linkId);

      // An edit that names the same driver again changes nothing.
      await setDriver(rentalId, driverId);
      await withTenant(web.db, operatorAId, (tx) =>
        tx.update(schema.rentals).set({ notes: "Kept" }).where(eq(schema.rentals.id, rentalId)),
      );

      expect(await rentalDriverOf(rentalId)).toBe(driverId);
    });
  });

  describe("who had the car (rule 15)", () => {
    it("fills in a possession's driver from the rental, as old code names none", async () => {
      const renterId = await addTestRenter(web.db, operatorAId);
      const out = await rentalOut(renterId);
      expect(out.possession).toMatchObject({ renterId, driverId: renterId });
    });

    it("gives a business's possession its driver, with the business as the Renter", async () => {
      const businessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      await linkDriver(operatorAId, businessId, driverId);
      const out = await rentalOut(businessId, driverId);
      expect(out.possession).toMatchObject({ renterId: businessId, driverId });
    });

    it("refuses a possession whose driver or Renter is not the rental's", async () => {
      const renterId = await addTestRenter(web.db, operatorAId);
      const otherId = await addTestRenter(web.db, operatorAId);
      const rental = await addRental({ renterId });
      const inspectionId = await addHandoverInspection(rental);
      const startedAt = new Date();
      const codes = await Promise.all([
        postgresErrorCodeOf(
          withTenant(web.db, operatorAId, (tx) =>
            handOver(tx, { ...rental, renterId }, inspectionId, { startedAt, driverId: otherId }),
          ),
        ),
        postgresErrorCodeOf(
          withTenant(web.db, operatorAId, (tx) =>
            handOver(tx, { ...rental, renterId: otherId }, inspectionId, { startedAt }),
          ),
        ),
      ]);
      expect(codes).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
    });

    it("refuses a driver change while the car is out, unless the new driver signs for it in the same step", async () => {
      const businessId = await addBusiness(operatorAId);
      const firstId = await addTestRenter(web.db, operatorAId);
      const secondId = await addTestRenter(web.db, operatorAId);
      await linkDriver(operatorAId, businessId, firstId);
      await linkDriver(operatorAId, businessId, secondId);
      const out = await rentalOut(businessId, firstId);

      const whileOut = await postgresErrorCodeOf(setDriver(out.rentalId, secondId));
      const withoutPossession = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, async (tx) => {
          await tx
            .update(schema.possessions)
            .set({ endedAt: new Date() })
            .where(eq(schema.possessions.id, out.possession.id));
          await tx
            .update(schema.rentals)
            .set({ driverId: secondId })
            .where(eq(schema.rentals.id, out.rentalId));
        }),
      );
      expect([whileOut, withoutPossession]).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
      expect(await rentalDriverOf(out.rentalId)).toBe(firstId);

      // The driver change (plan slice 4): the old possession ends, the driver
      // changes, and the new driver's possession starts at the same instant.
      const changedAt = new Date();
      // The new driver's handover checklist comes with slice 4; any checklist of the rental's will do here.
      const { inspectionId } = out;
      await withTenant(web.db, operatorAId, async (tx) => {
        await tx
          .update(schema.possessions)
          .set({ endedAt: changedAt })
          .where(eq(schema.possessions.id, out.possession.id));
        await tx
          .update(schema.rentals)
          .set({ driverId: secondId })
          .where(eq(schema.rentals.id, out.rentalId));
        await handOver(tx, out, inspectionId, { startedAt: changedAt });
      });

      const history = await withTenant(web.db, operatorAId, (tx) =>
        tx
          .select({
            driverId: schema.possessions.driverId,
            startedAt: schema.possessions.startedAt,
            endedAt: schema.possessions.endedAt,
          })
          .from(schema.possessions)
          .where(eq(schema.possessions.rentalId, out.rentalId))
          .orderBy(schema.possessions.startedAt),
      );
      expect(history).toEqual([
        { driverId: firstId, startedAt: out.possession.startedAt, endedAt: changedAt },
        { driverId: secondId, startedAt: changedAt, endedAt: null },
      ]);
    });
  });

  describe("tenant isolation", () => {
    it("hides another Operator's drivers' links", async () => {
      const businessId = await addBusiness(operatorBId);
      const driverId = await addTestRenter(web.db, operatorBId);
      await linkDriver(operatorBId, businessId, driverId);

      const seenByA = await withTenant(web.db, operatorAId, (tx) =>
        tx
          .select()
          .from(schema.organisationDrivers)
          .where(eq(schema.organisationDrivers.organisationId, businessId)),
      );
      const seenByB = await withTenant(web.db, operatorBId, (tx) =>
        tx
          .select()
          .from(schema.organisationDrivers)
          .where(eq(schema.organisationDrivers.organisationId, businessId)),
      );
      expect(seenByA).toEqual([]);
      expect(seenByB).toHaveLength(1);
    });

    it("refuses writing a link for another Operator, or changing one of theirs", async () => {
      const businessBId = await addBusiness(operatorBId);
      const driverBId = await addTestRenter(web.db, operatorBId);
      const linkBId = await linkDriver(operatorBId, businessBId, driverBId);

      const asB = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.insert(schema.organisationDrivers).values({
            operatorId: operatorBId,
            organisationId: businessBId,
            driverId: driverBId,
            addedByUserId: userAId,
          }),
        ),
      );
      const changed = await withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.organisationDrivers)
          .set({ removedAt: new Date(), removedByUserId: userAId })
          .where(eq(schema.organisationDrivers.id, linkBId))
          .returning(),
      );
      // Refused by the link's own check, which sees only A's Renters, or by row-level security.
      expect([POSTGRES_ERROR_CODES.insufficientPrivilege, CHECK_VIOLATION]).toContain(asB);
      expect(changed).toEqual([]);
    });

    it("can't link another Operator's Renters, nor name one as a driver", async () => {
      const businessAId = await addBusiness(operatorAId);
      const businessBId = await addBusiness(operatorBId);
      const driverAId = await addTestRenter(web.db, operatorAId);
      const personBId = await addTestRenter(web.db, operatorBId);
      await linkDriver(operatorAId, businessAId, driverAId);

      const codes = await Promise.all([
        postgresErrorCodeOf(linkDriver(operatorAId, businessAId, personBId)),
        postgresErrorCodeOf(linkDriver(operatorAId, businessBId, driverAId)),
        postgresErrorCodeOf(addRental({ renterId: businessAId, driverId: personBId })),
      ]);
      // Refused by the trigger, which only sees A's Renters, before the two-column link would.
      expect(codes.every((code) => [CHECK_VIOLATION, FOREIGN_KEY_VIOLATION].includes(code!))).toBe(
        true,
      );
    });
  });
});
