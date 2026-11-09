import { DEFAULT_HANDOVER_PHOTOS, isValidAbn } from "@fleetapp/core";
import { and, eq, inArray, sql } from "drizzle-orm";
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

  function cancel(rentalId: string) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.rentals)
        .set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: "Test" })
        .where(eq(schema.rentals.id, rentalId)),
    );
  }

  function archive(renterId: string) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.renters)
        .set({ archivedAt: new Date() })
        .where(eq(schema.renters.id, renterId)),
    );
  }

  describe("archiving, while a driver link is current (review F3)", () => {
    it("refuses archiving a driver or a business with a current link, and allows it once removed", async () => {
      const businessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      const linkId = await linkDriver(operatorAId, businessId, driverId);

      const codes = [
        await postgresErrorCodeOf(archive(driverId)),
        await postgresErrorCodeOf(archive(businessId)),
      ];
      await removeLink(linkId);
      await archive(driverId);
      await archive(businessId);

      expect(codes).toEqual([
        POSTGRES_ERROR_CODES.restrictViolation,
        POSTGRES_ERROR_CODES.restrictViolation,
      ]);
    });

    it("refuses a new link to an archived business or person", async () => {
      const businessId = await addBusiness(operatorAId);
      const archivedBusinessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      const archivedDriverId = await addTestRenter(web.db, operatorAId);
      await archive(archivedBusinessId);
      await archive(archivedDriverId);

      const codes = [
        await postgresErrorCodeOf(linkDriver(operatorAId, archivedBusinessId, driverId)),
        await postgresErrorCodeOf(linkDriver(operatorAId, businessId, archivedDriverId)),
      ];
      expect(codes).toEqual([
        POSTGRES_ERROR_CODES.restrictViolation,
        POSTGRES_ERROR_CODES.restrictViolation,
      ]);
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

    it("keeps a rental's driver once it has ended and the driver stopped driving for the business", async () => {
      const businessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      const linkId = await linkDriver(operatorAId, businessId, driverId);
      const { rentalId } = await addRental({ renterId: businessId, driverId });
      await cancel(rentalId);
      await removeLink(linkId);

      // An edit that names the same driver again changes nothing.
      await setDriver(rentalId, driverId);
      await withTenant(web.db, operatorAId, (tx) =>
        tx.update(schema.rentals).set({ notes: "Kept" }).where(eq(schema.rentals.id, rentalId)),
      );

      expect(await rentalDriverOf(rentalId)).toBe(driverId);
    });

    it("never removes a driver's link while a draft, booking or car out of the business names them (review F2)", async () => {
      const businessId = await addBusiness(operatorAId);
      const draftDriverId = await addTestRenter(web.db, operatorAId);
      const bookedDriverId = await addTestRenter(web.db, operatorAId);
      const outDriverId = await addTestRenter(web.db, operatorAId);
      const draftLink = await linkDriver(operatorAId, businessId, draftDriverId);
      const bookedLink = await linkDriver(operatorAId, businessId, bookedDriverId);
      const outLink = await linkDriver(operatorAId, businessId, outDriverId);
      await addRental({ renterId: businessId, driverId: draftDriverId }, { status: "draft" });
      const booked = await addRental({ renterId: businessId, driverId: bookedDriverId });
      await rentalOut(businessId, outDriverId);

      const codes = [
        await postgresErrorCodeOf(removeLink(draftLink)),
        await postgresErrorCodeOf(removeLink(bookedLink)),
        await postgresErrorCodeOf(removeLink(outLink)),
      ];
      // Once the booking names someone else, its driver's link can go.
      await setDriver(booked.rentalId, null);
      await removeLink(bookedLink);

      expect(codes).toEqual([
        POSTGRES_ERROR_CODES.restrictViolation,
        POSTGRES_ERROR_CODES.restrictViolation,
        POSTGRES_ERROR_CODES.restrictViolation,
      ]);
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

      // Not even with the new driver's possession in the same step, without a driver change under way (0057).
      const beforeChange = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, async (tx) => {
          await tx
            .update(schema.possessions)
            .set({ endedAt: new Date() })
            .where(eq(schema.possessions.id, out.possession.id));
          await tx
            .update(schema.rentals)
            .set({ driverId: secondId })
            .where(eq(schema.rentals.id, out.rentalId));
          await handOver(tx, out, out.inspectionId, { startedAt: new Date() });
        }),
      );
      expect(beforeChange).toBe(CHECK_VIOLATION);

      // The driver change (slice 4): under way with its own two checklists, the
      // old possession ends, the driver changes, and the new driver's starts at the same instant.
      const inspectionId = await withTenant(web.db, operatorAId, async (tx) => {
        // The car's own handover checklist, left open by this test's handover, out of the way.
        await tx
          .update(schema.inspections)
          .set({ status: "cancelled", cancelledAt: new Date() })
          .where(eq(schema.inspections.id, out.inspectionId));
        const pair = await tx
          .insert(schema.inspections)
          .values(
            (["return", "handover"] as const).map((kind) => ({
              operatorId: operatorAId,
              rentalId: out.rentalId,
              vehicleId: out.vehicleId,
              kind,
              photoNames: [],
              isForDriverChange: true,
              startedByUserId: userAId,
            })),
          )
          .returning({ id: schema.inspections.id, kind: schema.inspections.kind });
        const handoverId = pair.find((row) => row.kind === "handover")!.id;
        await tx.insert(schema.rentalDriverChanges).values({
          operatorId: operatorAId,
          rentalId: out.rentalId,
          fromDriverId: firstId,
          toDriverId: secondId,
          reason: "Night shifts",
          returnInspectionId: pair.find((row) => row.kind === "return")!.id,
          handoverInspectionId: handoverId,
          startedByUserId: userAId,
        });
        return handoverId;
      });
      const changedAt = new Date();
      // As the app finishes it (0058): the checklists and the change completed in the same step.
      await withTenant(web.db, operatorAId, async (tx) => {
        const [change] = await tx
          .select()
          .from(schema.rentalDriverChanges)
          .where(eq(schema.rentalDriverChanges.handoverInspectionId, inspectionId));
        await tx
          .update(schema.inspections)
          .set({
            status: "completed",
            completedAt: changedAt,
            odometerKm: 1_200,
            fuelLevel: "full",
            keysCount: 1,
            acceptanceText: "Accepted",
          })
          .where(inArray(schema.inspections.id, [change!.returnInspectionId, inspectionId]));
        await tx
          .update(schema.possessions)
          .set({ endedAt: changedAt, returnInspectionId: change!.returnInspectionId })
          .where(eq(schema.possessions.id, out.possession.id));
        await tx
          .update(schema.rentals)
          .set({ driverId: secondId })
          .where(eq(schema.rentals.id, out.rentalId));
        await handOver(tx, out, inspectionId, { startedAt: changedAt });
        await tx
          .update(schema.rentalDriverChanges)
          .set({ status: "completed", changedAt })
          .where(eq(schema.rentalDriverChanges.id, change!.id));
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

  describe("a finished rental keeps its driver (review F1)", () => {
    /** A business's car out with its first driver, and a second current driver. */
    async function outWithTwoDrivers() {
      const businessId = await addBusiness(operatorAId);
      const firstId = await addTestRenter(web.db, operatorAId);
      const secondId = await addTestRenter(web.db, operatorAId);
      await linkDriver(operatorAId, businessId, firstId);
      await linkDriver(operatorAId, businessId, secondId);
      return { ...(await rentalOut(businessId, firstId)), firstId, secondId };
    }

    const endPossession = (tx: AnyTransaction, possessionId: string) =>
      tx
        .update(schema.possessions)
        .set({ endedAt: new Date() })
        .where(eq(schema.possessions.id, possessionId));

    it("refuses a driver change made with the return itself", async () => {
      const out = await outWithTwoDrivers();
      const code = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, async (tx) => {
          await endPossession(tx, out.possession.id);
          await tx
            .update(schema.rentals)
            .set({ status: "returned", returnedAt: new Date(), driverId: out.secondId })
            .where(eq(schema.rentals.id, out.rentalId));
        }),
      );
      expect(code).toBe(CHECK_VIOLATION);
      expect(await rentalDriverOf(out.rentalId)).toBe(out.firstId);
    });

    it("refuses a driver change slipped in between the possession ending and the return", async () => {
      const out = await outWithTwoDrivers();
      const code = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, async (tx) => {
          await endPossession(tx, out.possession.id);
          await tx
            .update(schema.rentals)
            .set({ driverId: out.secondId })
            .where(eq(schema.rentals.id, out.rentalId));
          await tx
            .update(schema.rentals)
            .set({ status: "returned", returnedAt: new Date() })
            .where(eq(schema.rentals.id, out.rentalId));
        }),
      );
      expect(code).toBe(CHECK_VIOLATION);
      expect(await rentalDriverOf(out.rentalId)).toBe(out.firstId);
    });

    it("still takes an ordinary return", async () => {
      const out = await outWithTwoDrivers();
      await withTenant(web.db, operatorAId, async (tx) => {
        await endPossession(tx, out.possession.id);
        await tx
          .update(schema.rentals)
          .set({ status: "returned", returnedAt: new Date() })
          .where(eq(schema.rentals.id, out.rentalId));
      });
      expect(await rentalDriverOf(out.rentalId)).toBe(out.firstId);
    });
  });

  it("puts a business's car out only to a current driver of its (review F2)", async () => {
    const businessId = await addBusiness(operatorAId);
    const driverId = await addTestRenter(web.db, operatorAId);
    const linkId = await linkDriver(operatorAId, businessId, driverId);
    const rental = await addRental({ renterId: businessId, driverId });
    // A link removed as no app role can while the booking names them (as before the fix).
    await superuser.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx
        .update(schema.organisationDrivers)
        .set({ removedAt: new Date() })
        .where(eq(schema.organisationDrivers.id, linkId));
    });
    const inspectionId = await addHandoverInspection(rental);

    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        handOver(tx, { ...rental, renterId: businessId }, inspectionId, { startedAt: new Date() }),
      ),
    );
    expect(code).toBe(CHECK_VIOLATION);
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

  describe("retention, counting driving", () => {
    const EIGHT_YEARS_AGO = sql`now() - interval '8 years'`;
    const EIGHT_YEARS_AND_A_WEEK_AGO = sql`now() - interval '8 years 7 days'`;

    async function keptUntil(renterId: string): Promise<Date> {
      const result = await withTenant(web.db, operatorAId, (tx) =>
        tx.execute<{ until: string }>(
          sql`select app.renter_records_kept_until(${renterId}) as until`,
        ),
      );
      return new Date(result.rows[0]!.until);
    }

    async function isInUse(renterId: string): Promise<boolean> {
      const result = await withTenant(web.db, operatorAId, (tx) =>
        tx.execute<{ in_use: boolean }>(sql`select app.is_renter_in_use(${renterId}) as in_use`),
      );
      return result.rows[0]!.in_use;
    }

    async function retire(renterId: string): Promise<boolean> {
      const result = await withTenant(web.db, operatorAId, (tx) =>
        tx.execute<{ retired: boolean }>(sql`select app.retire_renter(${renterId}) as retired`),
      );
      return result.rows[0]!.retired;
    }

    /**
     * A business's rental, driven by `driverId` and returned eight years ago
     * (dated back with the app's triggers off, as no app role can), with the
     * driver's typed name on its handover. The driver's link ended then too.
     */
    async function oldBusinessRental(businessId: string, driverId: string) {
      const linkId = await linkDriver(operatorAId, businessId, driverId);
      const out = await rentalOut(businessId, driverId);
      await withTenant(web.db, operatorAId, async (tx) => {
        await tx
          .update(schema.possessions)
          .set({ endedAt: new Date() })
          .where(eq(schema.possessions.id, out.possession.id));
        await tx
          .update(schema.rentals)
          .set({ status: "returned", returnedAt: new Date() })
          .where(eq(schema.rentals.id, out.rentalId));
      });
      await removeLink(linkId);
      await superuser.db.transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx
          .update(schema.rentals)
          .set({
            createdAt: EIGHT_YEARS_AGO,
            handedOverAt: EIGHT_YEARS_AND_A_WEEK_AGO,
            returnedAt: EIGHT_YEARS_AGO,
          })
          .where(eq(schema.rentals.id, out.rentalId));
        await tx
          .update(schema.possessions)
          .set({ startedAt: EIGHT_YEARS_AND_A_WEEK_AGO, endedAt: EIGHT_YEARS_AGO })
          .where(eq(schema.possessions.id, out.possession.id));
        await tx
          .update(schema.inspections)
          .set({ signatureMethod: "typed", typedName: "Sam Driver" })
          .where(eq(schema.inspections.id, out.inspectionId));
        await tx
          .update(schema.organisationDrivers)
          .set({ addedAt: EIGHT_YEARS_AND_A_WEEK_AGO, removedAt: EIGHT_YEARS_AGO })
          .where(eq(schema.organisationDrivers.id, linkId));
      });
      return out;
    }

    async function ageRenters(...renterIds: string[]): Promise<void> {
      await superuser.db.transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        for (const renterId of renterIds) {
          await tx
            .update(schema.renters)
            .set({ createdAt: EIGHT_YEARS_AGO })
            .where(eq(schema.renters.id, renterId));
        }
      });
    }

    const typedNameOf = async (inspectionId: string) => {
      const [row] = await withTenant(web.db, operatorAId, (tx) =>
        tx
          .select({ typedName: schema.inspections.typedName })
          .from(schema.inspections)
          .where(eq(schema.inspections.id, inspectionId)),
      );
      return row!.typedName;
    };

    it("counts a driver's time with a business's car and their link, not only their own rentals", async () => {
      const businessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      await ageRenters(driverId);
      const linkId = await linkDriver(operatorAId, businessId, driverId);
      const inUseWhileLinked = await isInUse(driverId);
      await removeLink(linkId);
      const untilAfterLink = await keptUntil(driverId);

      const sevenYearsOn = Date.now() + 6.9 * 365 * 24 * HOUR_MS;
      expect(inUseWhileLinked).toBe(true);
      expect(await isInUse(driverId)).toBe(false);
      expect(untilAfterLink.getTime()).toBeGreaterThan(sevenYearsOn);
      expect(await retire(driverId)).toBe(false);
    });

    it("doesn't retire a driver with no rentals of their own while they have a business's car", async () => {
      const businessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      await linkDriver(operatorAId, businessId, driverId);
      await rentalOut(businessId, driverId);
      await ageRenters(driverId);

      expect(await isInUse(driverId)).toBe(true);
      expect(await retire(driverId)).toBe(false);
    });

    it("keeps a business rental's personal records until the business and every driver are past seven years", async () => {
      const businessId = await addBusiness(operatorAId);
      const driverId = await addTestRenter(web.db, operatorAId);
      const recentBusinessId = await addBusiness(operatorAId);
      const old = await oldBusinessRental(businessId, driverId);
      // The driver drove another business's car since: their seven years aren't up.
      const recent = await oldBusinessRental(recentBusinessId, driverId);
      await superuser.db.transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx
          .update(schema.possessions)
          .set({ endedAt: sql`now() - interval '1 year'` })
          .where(eq(schema.possessions.id, recent.possession.id));
      });
      await ageRenters(businessId, driverId);

      expect(await retire(driverId)).toBe(false);
      expect(await retire(businessId)).toBe(true);
      expect(await typedNameOf(old.inspectionId)).toBe("Sam Driver");

      await superuser.db.transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx
          .update(schema.possessions)
          .set({ endedAt: EIGHT_YEARS_AGO })
          .where(eq(schema.possessions.id, recent.possession.id));
      });
      expect(await retire(driverId)).toBe(true);
      expect(await typedNameOf(old.inspectionId)).toBe("Removed");
      // The other business isn't retired yet, so its rental's records stay.
      expect(await typedNameOf(recent.inspectionId)).toBe("Sam Driver");

      const [business] = await withTenant(web.db, operatorAId, (tx) =>
        tx
          .select()
          .from(schema.renters)
          .where(
            and(eq(schema.renters.id, businessId), eq(schema.renters.operatorId, operatorAId)),
          ),
      );
      expect(business).toMatchObject({
        kind: "organisation",
        tradingName: null,
        abn: null,
        contactName: null,
        email: null,
        retiredAt: expect.any(Date),
      });
    });
  });
});
