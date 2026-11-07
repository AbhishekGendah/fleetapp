import { drawnSignatureInput, RETIRED_RENTER_NAME } from "@fleetapp/core";
import {
  activityLog,
  files,
  inspections,
  issuedDocuments,
  ledgerLines,
  organisationDrivers,
  possessions,
  rentals,
  renters,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { completeHandover } from "../src/lib/handover/complete-handover";
import { NO_OVERRIDE_REASONS } from "../src/lib/handover/override-reasons";
import { cancelRental } from "../src/lib/rentals/rental-records";
import { restoreRenter } from "../src/lib/renters/renter-records";
import { retireOldRenters } from "../src/lib/renters/renter-retirement";
import { createMemoryFileStorage } from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, TEST_SIGNATURE } from "./handover-fixtures";
import { bookTestRental, TEST_TIME_ZONE } from "./rental-fixtures";

/** Long enough ago that seven years have passed, whatever today is. */
const EIGHT_YEARS_AGO = sql`now() - interval '8 years'`;
const EIGHT_YEARS_AND_A_WEEK_AGO = sql`now() - interval '8 years 7 days'`;

/** A Renter's records seven years on (review G8-4). */
describe("removing a Renter's details seven years after their last rental", () => {
  let admin: TestConnection;
  let web: TestConnection;
  /** Only to date records back: no app role can. */
  let superuser: TestConnection;
  let actor: ActingUser;
  let otherBusiness: ActingUser;
  let kit: ReturnType<typeof checklistKit>;
  let otherKit: ReturnType<typeof checklistKit>;

  /** A booking for a Renter with a licence and scans on file and a signed contract, then cancelled. */
  async function cancelledBooking(
    owner: ActingUser,
    ownKit: ReturnType<typeof checklistKit>,
    isBondHeld = false,
  ): Promise<{ rentalId: string; renterId: string }> {
    const { rentalId } = await ownKit.readyRental({ isBondHeld });
    await cancelRental(web.db, owner, rentalId, { reason: "Changed plans" }, new Date());
    const [rental] = await withTenant(web.db, owner.operatorId, (tx) =>
      tx.select({ renterId: rentals.renterId }).from(rentals).where(eq(rentals.id, rentalId)),
    );
    return { rentalId, renterId: rental!.renterId };
  }

  /**
   * Dates a Renter and their rentals eight years back: rentals come back or
   * are cancelled then. Done as the superuser with the app's own triggers
   * off, as no app role (rightly) can rewrite those times.
   */
  async function ageRenter(renterId: string): Promise<void> {
    await superuser.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.update(renters).set({ createdAt: EIGHT_YEARS_AGO }).where(eq(renters.id, renterId));
      await tx
        .update(rentals)
        .set({ createdAt: EIGHT_YEARS_AGO })
        .where(eq(rentals.renterId, renterId));
      await tx
        .update(rentals)
        .set({ cancelledAt: EIGHT_YEARS_AGO })
        .where(and(eq(rentals.renterId, renterId), eq(rentals.status, "cancelled")));
      await tx
        .update(rentals)
        .set({
          status: "returned",
          handedOverAt: EIGHT_YEARS_AND_A_WEEK_AGO,
          returnedAt: EIGHT_YEARS_AGO,
        })
        .where(and(eq(rentals.renterId, renterId), eq(rentals.status, "active")));
      // A return ends the time with the car too (rule 15), which now counts (plan Migration A step 8).
      await tx
        .update(possessions)
        .set({ startedAt: EIGHT_YEARS_AND_A_WEEK_AGO, endedAt: EIGHT_YEARS_AGO })
        .where(and(eq(possessions.renterId, renterId), isNull(possessions.endedAt)));
    });
  }

  const retireDirectly = (owner: ActingUser, renterId: string) =>
    withTenant(web.db, owner.operatorId, async (tx) => {
      const result = await tx.execute(sql`select app.retire_renter(${renterId}) as retired`);
      return (result.rows[0] as { retired: boolean }).retired;
    });

  const renterOf = (owner: ActingUser, renterId: string) =>
    withTenant(web.db, owner.operatorId, async (tx) => {
      const [row] = await tx.select().from(renters).where(eq(renters.id, renterId));
      return row!;
    });

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    const storage = createMemoryFileStorage();
    const sentEmails: EmailMessage[] = [];
    actor = await seedOperatorWithUser(admin, "Retention Rentals Pty Ltd");
    otherBusiness = await seedOperatorWithUser(admin, "Other Retention Pty Ltd");
    kit = checklistKit(web, storage, sentEmails, actor);
    otherKit = checklistKit(web, storage, sentEmails, otherBusiness);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.close()]);
  });

  it("removes their details and bins their documents and scans, leaving the money alone", async () => {
    const { rentalId, renterId } = await cancelledBooking(actor, kit);
    await ageRenter(renterId);
    const linesBefore = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(ledgerLines).where(eq(ledgerLines.rentalId, rentalId)),
    );

    const summary = await retireOldRenters(web.db);

    expect(summary.retiredRenters).toBeGreaterThanOrEqual(1);
    expect(summary.failedOperators).toBe(0);
    expect(await renterOf(actor, renterId)).toMatchObject({
      fullName: RETIRED_RENTER_NAME,
      phone: null,
      email: null,
      dateOfBirth: null,
      licenceNumber: null,
      retiredAt: expect.any(Date),
    });
    const theirFiles = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ id: files.id, deletedAt: files.deletedAt })
        .from(files)
        .leftJoin(issuedDocuments, eq(issuedDocuments.fileId, files.id))
        .where(or(eq(files.renterId, renterId), eq(issuedDocuments.rentalId, rentalId))),
    );
    expect(theirFiles.length).toBeGreaterThanOrEqual(3);
    expect(theirFiles.every((file) => file.deletedAt !== null)).toBe(true);
    // The usual clean-up may now remove them for good, issued PDFs included.
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .update(files)
        .set({ purgedAt: new Date() })
        .where(
          inArray(
            files.id,
            theirFiles.map((file) => file.id),
          ),
        ),
    );
    // The books still add up: every money line is still there, unchanged.
    expect(
      await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select().from(ledgerLines).where(eq(ledgerLines.rentalId, rentalId)),
      ),
    ).toEqual(linesBefore);
    const [line] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ actorType: activityLog.actorType, action: activityLog.action })
        .from(activityLog)
        .where(and(eq(activityLog.entityId, renterId), eq(activityLog.action, "purged"))),
    );
    expect(line).toEqual({ actorType: "system", action: "purged" });
  });

  it("keeps a Renter with a bond still held, a booking, or not yet seven years on", async () => {
    const bondHeld = await cancelledBooking(actor, kit, true);
    await ageRenter(bondHeld.renterId);
    const { rentalId: bookedRentalId } = await kit.readyRental({ isBondHeld: false });
    const [booked] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select({ renterId: rentals.renterId }).from(rentals).where(eq(rentals.id, bookedRentalId)),
    );
    await ageRenter(booked!.renterId);
    const recent = await cancelledBooking(actor, kit);

    await retireOldRenters(web.db);

    for (const renterId of [bondHeld.renterId, booked!.renterId, recent.renterId]) {
      expect((await renterOf(actor, renterId)).retiredAt).toBeNull();
    }
  });

  it("keeps a driver with no rentals of their own while they drive for a business", async () => {
    // Adding a business and its drivers comes in a later slice; written straight in here.
    const driverId = await withTenant(web.db, actor.operatorId, async (tx) => {
      const [business] = await tx
        .insert(renters)
        .values({
          operatorId: actor.operatorId,
          kind: "organisation",
          fullName: "Acme Rideshare Pty Ltd",
          email: "accounts@acme.example.test",
        })
        .returning({ id: renters.id });
      const [driver] = await tx
        .insert(renters)
        .values({ operatorId: actor.operatorId, fullName: "Sam Driver", phone: "0412345678" })
        .returning({ id: renters.id });
      await tx.insert(organisationDrivers).values({
        operatorId: actor.operatorId,
        organisationId: business!.id,
        driverId: driver!.id,
        addedByUserId: actor.userId,
      });
      return driver!.id;
    });
    await ageRenter(driverId);

    await retireOldRenters(web.db);

    expect((await renterOf(actor, driverId)).retiredAt).toBeNull();
    expect(await retireDirectly(actor, driverId)).toBe(false);
  });

  it("never removes another business's Renter, nor anyone not yet seven years on, even if asked", async () => {
    const theirs = await cancelledBooking(otherBusiness, otherKit);
    await ageRenter(theirs.renterId);
    const recent = await cancelledBooking(actor, kit);
    expect(await retireDirectly(actor, theirs.renterId)).toBe(false);
    expect(await retireDirectly(actor, recent.renterId)).toBe(false);
    expect((await renterOf(otherBusiness, theirs.renterId)).retiredAt).toBeNull();
    // And the app's own role can't mark anyone retired itself.
    await expect(
      withTenant(web.db, actor.operatorId, (tx) =>
        tx.update(renters).set({ retiredAt: new Date() }).where(eq(renters.id, recent.renterId)),
      ),
    ).rejects.toThrow();
  });

  it("bins a returned rental's checklist photos and their small copies (batch 5 review)", async () => {
    const { rentalId } = await kit.rentalOut(new Date());
    const [rental] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select({ renterId: rentals.renterId }).from(rentals).where(eq(rentals.id, rentalId)),
    );
    await ageRenter(rental!.renterId);

    expect(await retireDirectly(actor, rental!.renterId)).toBe(true);

    const photos = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ id: files.id, purpose: files.purpose, deletedAt: files.deletedAt })
        .from(files)
        .innerJoin(inspections, eq(inspections.id, files.inspectionId))
        .where(eq(inspections.rentalId, rentalId)),
    );
    const thumbnails = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ deletedAt: files.deletedAt })
        .from(files)
        .where(
          inArray(
            files.thumbnailOfFileId,
            photos.map((photo) => photo.id),
          ),
        ),
    );
    expect(photos.length).toBeGreaterThan(0);
    expect(thumbnails).toHaveLength(photos.length);
    expect([...photos, ...thumbnails].every((file) => file.deletedAt !== null)).toBe(true);
  });

  it("removes the paperwork reasons typed at handover, which may name them (batch 7)", async () => {
    const { rentalId, renterId } = await kit.readyRental({ isPaperworkOnFile: false });
    const inspectionId = await kit.filledHandover(rentalId);
    const handedOver = await completeHandover(
      kit.handoverDeps(),
      actor,
      inspectionId,
      {
        ...NO_OVERRIDE_REASONS,
        insuranceOverrideReason: "Policy is in Rory's name",
        regoOverrideReason: "Rory renewed it today",
        shownFingerprint: await kit.shown(inspectionId),
        signature: drawnSignatureInput(TEST_SIGNATURE),
      },
      { timeZone: TEST_TIME_ZONE, now: new Date() },
    );
    await ageRenter(renterId);

    expect(handedOver.status).toBe("completed");
    expect(await retireDirectly(actor, renterId)).toBe(true);
    const [checklist] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({
          insurance: inspections.insuranceOverrideReason,
          rego: inspections.regoOverrideReason,
        })
        .from(inspections)
        .where(eq(inspections.id, inspectionId)),
    );
    expect(checklist).toEqual({ insurance: "Removed", rego: "Removed" });
  });

  it("keeps a retired Renter as left: the app can't restore, edit, re-add or un-bin (batch 5 review)", async () => {
    const { rentalId, renterId } = await cancelledBooking(actor, kit);
    await ageRenter(renterId);
    expect(await retireDirectly(actor, renterId)).toBe(true);
    const [contract] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ fileId: issuedDocuments.fileId })
        .from(issuedDocuments)
        .where(eq(issuedDocuments.rentalId, rentalId)),
    );

    expect(await restoreRenter(web.db, actor, renterId)).toBe("unchanged");
    await expect(
      withTenant(web.db, actor.operatorId, (tx) =>
        tx.update(renters).set({ fullName: "Back Again" }).where(eq(renters.id, renterId)),
      ),
    ).rejects.toThrow();
    await expect(bookTestRental(web, actor, renterId)).rejects.toThrow();
    // A binned PDF is never un-binned by the app.
    await expect(
      withTenant(web.db, actor.operatorId, (tx) =>
        tx.update(files).set({ deletedAt: null }).where(eq(files.id, contract!.fileId)),
      ),
    ).rejects.toThrow();
  });

  it("never lets the app use a retired Renter to bin a document that is kept for good (batch 5 review)", async () => {
    const retired = await cancelledBooking(actor, kit);
    await ageRenter(retired.renterId);
    expect(await retireDirectly(actor, retired.renterId)).toBe(true);
    const { rentalId: liveRentalId } = await kit.readyRental({ isBondHeld: false });
    const [liveContract] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ fileId: issuedDocuments.fileId })
        .from(issuedDocuments)
        .where(eq(issuedDocuments.rentalId, liveRentalId)),
    );

    // Pointed at the retired Renter, then binned: refused, as the binning isn't the job's.
    await expect(
      withTenant(web.db, actor.operatorId, async (tx) => {
        await tx
          .update(files)
          .set({ renterId: retired.renterId })
          .where(eq(files.id, liveContract!.fileId));
        await tx
          .update(files)
          .set({ deletedAt: new Date() })
          .where(eq(files.id, liveContract!.fileId));
      }),
    ).rejects.toThrow();
  });

  it("keeps a Renter with a draft rental: it restarts the clock (batch 5 review)", async () => {
    const withDraft = await cancelledBooking(actor, kit);
    await ageRenter(withDraft.renterId);
    await bookTestRental(web, actor, withDraft.renterId, "draft");

    expect(await retireDirectly(actor, withDraft.renterId)).toBe(false);
    expect((await renterOf(actor, withDraft.renterId)).retiredAt).toBeNull();
  });
});
