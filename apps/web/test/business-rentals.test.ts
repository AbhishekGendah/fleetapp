import { drawnSignatureInput, type TemplateDocument } from "@fleetapp/core";
import {
  activityLog,
  carSwaps,
  inspections,
  issuedDocuments,
  possessions,
  rentals,
  signingEvidence,
  vehicles,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { emailDocumentAgain, loadDocumentEmailStates } from "../src/lib/contracts/document-emails";
import { loadSigningView, signContract } from "../src/lib/contracts/signing";
import { sendSigningLink } from "../src/lib/contracts/signing-links";
import { createTemplate, saveTemplate } from "../src/lib/contracts/templates";
import { completeHandover } from "../src/lib/handover/complete-handover";
import { completeReturn } from "../src/lib/handover/complete-return";
import { completeSwap, currentShownSwap } from "../src/lib/handover/complete-swap";
import { startHandover, startReturn } from "../src/lib/handover/handover-records";
import { startSwap } from "../src/lib/rentals/car-swaps";
import { loadRentalProblems } from "../src/lib/rentals/booking-checks";
import { bookingProblemMessage } from "../src/lib/rentals/rental-messages";
import { listBusinessChoices } from "../src/lib/rentals/driver-choices";
import { listPickableRenters } from "../src/lib/rentals/pickable-records";
import { loadRental } from "../src/lib/rentals/rental-queries";
import { bookRental, nameRentalDriver } from "../src/lib/rentals/rental-records";
import {
  emptyBusinessRenterForm,
  parseBusinessRenterForm,
} from "../src/lib/renters/business-renter-input";
import { listDriverCandidates } from "../src/lib/renters/organisation-driver-queries";
import { addExistingDriver, removeDriver } from "../src/lib/renters/organisation-driver-records";
import {
  archiveRenter,
  changeRenterStatus,
  createBusinessRenter,
} from "../src/lib/renters/renter-records";
import { openLink } from "../src/lib/renter-links/link-visits";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { addCurrentPaperwork, addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, HANDOVER_KM, TEST_SIGNATURE } from "./handover-fixtures";
import { openTransactionAs, waitUntilBlockedBy } from "./lock-fixtures";
import {
  addRenterReadyToRent,
  addTestRenter,
  attemptTestBooking,
  bookTestRentalOn,
  recordTestHandover,
  TEST_TIME_ZONE,
} from "./rental-fixtures";
import {
  linkTestKit,
  openRenterLink,
  recordingEmailSender,
  sendEverything,
} from "./renter-link-fixtures";

const CLOCK = { timeZone: TEST_TIME_ZONE, now: new Date("2026-11-08T02:00:00Z") };
const EXPIRY = { today: "2026-11-08", warningDays: 30 };
const LEGAL_NAME = "Acme Rideshare Pty Ltd";
const CONTACT_EMAIL = "dana.wells@acme.example.test";
/** The email every driver made by `addRenterReadyToRent` has on file. */
const DRIVER_EMAIL = "rory.ready@example.test";
const TOKEN_PATTERN = /\/r\/([A-Za-z0-9_-]+)/;
const META = { ipAddress: "203.0.113.9", userAgent: "Mozilla/5.0 (iPhone)" };

/** A short business contract: fields every test business has on file. */
const SHORT_BUSINESS_CONTRACT: TemplateDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "mergeField", attrs: { key: "renterLegalName" } },
        { type: "text", text: " (ABN " },
        { type: "mergeField", attrs: { key: "renterAbn" } },
        { type: "text", text: ") rents " },
        { type: "mergeField", attrs: { key: "carRego" } },
        { type: "text", text: "." },
      ],
    },
  ],
};

/**
 * Renting to a business (docs/plans/business-renters.md, slice 3): the
 * driver picker and "to be named", naming a driver later, the business
 * contract and its authorised signing, and the driver signing for the car.
 */
describe("renting to a business", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: Client;
  let superuserDb: TestConnection;
  let storage: MemoryFileStorage;
  let actor: ActingUser;
  let otherActor: ActingUser;
  const sentEmails: EmailMessage[] = [];

  const linkDeps = () => ({
    database: web.db,
    storage,
    emailSender: recordingEmailSender(sentEmails),
    now: () => new Date(),
    appUrl: "https://app.example.test",
    describeDay: () => "Sunday 8 November",
    describeMoment: () => "10:00 am AWST, Sunday 8 November",
  });

  async function addBusiness(owner = actor): Promise<string> {
    const parsed = parseBusinessRenterForm({
      ...emptyBusinessRenterForm(),
      fullName: LEGAL_NAME,
      tradingName: "Acme Rides",
      abn: "51 824 753 556",
      contactName: "Dana Wells",
      email: CONTACT_EMAIL,
      businessAddress: "Unit 4, 12 Example Road, Osborne Park WA 6017",
    });
    return createBusinessRenter(web.db, owner, parsed.data!);
  }

  /** A business with one current driver, who has everything renting needs on file. */
  async function businessWithDriver(owner = actor, driverName = "Sam Lee") {
    const businessId = await addBusiness(owner);
    const driverId = await addRenterReadyToRent(
      web,
      { database: web.db, storage, now: () => new Date() },
      owner,
      driverName,
    );
    expect((await addExistingDriver(web.db, owner, businessId, driverId)).status).toBe("added");
    return { businessId, driverId };
  }

  /** Another of the business's drivers, with everything renting needs on file. */
  async function anotherDriver(businessId: string, driverName: string): Promise<string> {
    const driverId = await addRenterReadyToRent(
      web,
      { database: web.db, storage, now: () => new Date() },
      actor,
      driverName,
    );
    expect((await addExistingDriver(web.db, actor, businessId, driverId)).status).toBe("added");
    return driverId;
  }

  /** One of the business's drivers whose details, sent through their link, wait for review. */
  async function driverWaitingReview(businessId: string): Promise<string> {
    const kit = linkTestKit(web, actor);
    const visit = await openRenterLink(kit, "Pat Waiting");
    await sendEverything(kit, visit);
    expect((await addExistingDriver(web.db, actor, businessId, visit.renterId)).status).toBe(
      "added",
    );
    return visit.renterId;
  }

  async function carWithPaperwork(owner = actor): Promise<string> {
    const vehicleId = await addTestCar(web, owner);
    await addCurrentPaperwork(web, owner, vehicleId);
    return vehicleId;
  }

  async function driverOf(rentalId: string, owner = actor): Promise<string | null | undefined> {
    const [row] = await withTenant(web.db, owner.operatorId, (tx) =>
      tx.select({ driverId: rentals.driverId }).from(rentals).where(eq(rentals.id, rentalId)),
    );
    return row?.driverId;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    superuserDb = connectAs(inject("superuserUrl"));
    storage = createMemoryFileStorage();
    actor = await seedOperatorWithUser(admin, "Business Rentals Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Business Rentals Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuserDb.close(), superuser.end()]);
  });

  describe("booking with the driver picker", () => {
    it("offers a business on the New rental form, by its trading name, never as a driver", async () => {
      const { businessId } = await businessWithDriver();
      const picked = await listPickableRenters(web.db, actor.operatorId);
      const candidates = await listDriverCandidates(web.db, actor.operatorId, businessId);

      expect(picked.find((record) => record.value === businessId)).toMatchObject({
        label: "Acme Rides",
        description: `Business · ${LEGAL_NAME} · ABN 51 824 753 556`,
      });
      expect(candidates.map((record) => record.value)).not.toContain(businessId);
    });

    it("books with the driver to be named: allowed, but the handover waits for one", async () => {
      const { businessId } = await businessWithDriver();
      const vehicleId = await carWithPaperwork();

      const booked = await bookTestRentalOn(web, actor, { renterId: businessId, vehicleId });

      expect(await driverOf(booked.rentalId)).toBeNull();
      expect(booked.problems.map((problem) => problem.code)).toContain("driver_not_named");
    });

    it("books with one of its drivers, and warns (never refuses) when they have another car out", async () => {
      const { businessId, driverId } = await businessWithDriver();
      const first = await bookTestRentalOn(web, actor, {
        renterId: businessId,
        vehicleId: await carWithPaperwork(),
        driverId,
      });
      await recordTestHandover(superuserDb, first.rentalId, new Date("2026-11-01T01:00:00Z"));
      const secondCar = await carWithPaperwork();
      const [rego] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ rego: vehicles.rego })
          .from(rentals)
          .innerJoin(vehicles, eq(vehicles.id, rentals.vehicleId))
          .where(eq(rentals.id, first.rentalId)),
      );

      const second = await bookTestRentalOn(web, actor, {
        renterId: businessId,
        vehicleId: secondCar,
        driverId,
      });

      expect(await driverOf(first.rentalId)).toBe(driverId);
      expect(await driverOf(second.rentalId)).toBe(driverId);
      expect(second.problems).toContainEqual({
        code: "driver_has_other_car",
        level: "notice",
        regos: [rego!.rego],
      });
    });

    it("refuses someone who isn't its driver, or an archived person, with words for each", async () => {
      const { businessId } = await businessWithDriver();
      const stranger = await addTestRenter(web, actor, "Not A Driver");
      const archived = await addTestRenter(web, actor, "Archived Person");
      expect(await archiveRenter(web.db, actor, archived)).toBe("changed");
      const vehicleId = await carWithPaperwork();

      const notDriver = await attemptTestBooking(web, actor, {
        renterId: businessId,
        vehicleId,
        driverId: stranger,
      });
      const archivedDriver = await attemptTestBooking(web, actor, {
        renterId: businessId,
        vehicleId,
        driverId: archived,
      });

      expect(notDriver.status).toBe("driver_not_current");
      expect(archivedDriver.status).toBe("driver_archived");
    });

    it("refuses a driver whose details wait for review, as the picker greys them out", async () => {
      const { businessId } = await businessWithDriver();
      const waitingId = await driverWaitingReview(businessId);

      const result = await attemptTestBooking(web, actor, {
        renterId: businessId,
        vehicleId: await carWithPaperwork(),
        driverId: waitingId,
      });

      expect(result.status).toBe("driver_waiting_review");
    });

    it("won't book a draft whose driver's details now wait for review, as naming one won't", async () => {
      const { businessId, driverId } = await businessWithDriver();
      const draft = await attemptTestBooking(web, actor, {
        renterId: businessId,
        vehicleId: await carWithPaperwork(),
        driverId,
        status: "draft",
      });
      if (draft.status !== "saved") {
        throw new Error(`The draft was not saved: ${draft.status}`);
      }
      // Stands for the draft's driver sending details through their link after it was saved.
      const waitingId = await driverWaitingReview(businessId);
      await superuser.query("update rentals set driver_id = $2 where id = $1", [
        draft.rentalId,
        waitingId,
      ]);

      const booked = await bookRental(web.db, actor, draft.rentalId, CLOCK);

      expect(booked.status).toBe("driver_waiting_review");
      const [row] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select({ status: rentals.status }).from(rentals).where(eq(rentals.id, draft.rentalId)),
      );
      expect(row?.status).toBe("draft");
    });

    it("refuses a driver marked Do not rent", async () => {
      const { businessId, driverId } = await businessWithDriver();
      await changeRenterStatus(web.db, actor, driverId, {
        status: "do_not_rent",
        doNotRentReason: "Test",
      });

      const result = await attemptTestBooking(web, actor, {
        renterId: businessId,
        vehicleId: await carWithPaperwork(),
        driverId,
      });

      expect(result.status).toBe("refused");
    });

    it("keeps a person's own booking exactly as before: they drive, whatever the form sent", async () => {
      const { driverId: otherPerson } = await businessWithDriver();
      const personId = await addTestRenter(web, actor, "Own Booking");
      const booked = await bookTestRentalOn(web, actor, {
        renterId: personId,
        vehicleId: await carWithPaperwork(),
        driverId: otherPerson,
      });

      expect(await driverOf(booked.rentalId)).toBe(personId);
    });
  });

  describe("naming a driver later", () => {
    async function bookingToBeNamed() {
      const parties = await businessWithDriver();
      const booked = await bookTestRentalOn(web, actor, {
        renterId: parties.businessId,
        vehicleId: await carWithPaperwork(),
      });
      return { ...parties, rentalId: booked.rentalId };
    }

    it("names one, logs it without their name, and puts it back to be named", async () => {
      const { rentalId, driverId } = await bookingToBeNamed();

      const named = await nameRentalDriver(web.db, actor, rentalId, { driverId }, CLOCK);
      const again = await nameRentalDriver(web.db, actor, rentalId, { driverId }, CLOCK);
      const cleared = await nameRentalDriver(web.db, actor, rentalId, { driverId: null }, CLOCK);

      expect(named.status).toBe("saved");
      expect(again.status).toBe("unchanged");
      expect(cleared.status).toBe("saved");
      expect(await driverOf(rentalId)).toBeNull();
      const log = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ valuesAfter: activityLog.valuesAfter })
          .from(activityLog)
          .where(and(eq(activityLog.entityId, rentalId), eq(activityLog.action, "updated"))),
      );
      expect(log.map((entry) => entry.valuesAfter)).toContainEqual(
        expect.objectContaining({ driverId }),
      );
      expect(JSON.stringify(log)).not.toContain("Sam Lee");
    });

    it("won't name a driver whose details wait for review, even posted directly", async () => {
      const { rentalId, businessId } = await bookingToBeNamed();
      const waitingId = await driverWaitingReview(businessId);

      const result = await nameRentalDriver(
        web.db,
        actor,
        rentalId,
        { driverId: waitingId },
        CLOCK,
      );

      expect(result.status).toBe("driver_waiting_review");
      expect(await driverOf(rentalId)).toBeNull();
    });

    it("finds the same driver named again unchanged, even once their details wait for review", async () => {
      const { rentalId, businessId } = await bookingToBeNamed();
      const waitingId = await driverWaitingReview(businessId);
      // Named before they sent their details: the rental already names them.
      await superuser.query("update rentals set driver_id = $2 where id = $1", [
        rentalId,
        waitingId,
      ]);

      const again = await nameRentalDriver(web.db, actor, rentalId, { driverId: waitingId }, CLOCK);

      expect(again.status).toBe("unchanged");
      expect(await driverOf(rentalId)).toBe(waitingId);
    });

    it("won't change or clear the driver while a handover checklist is under way", async () => {
      const { businessId, driverId } = await businessWithDriver();
      const otherDriverId = await anotherDriver(businessId, "Kim Other");
      const booked = await bookTestRentalOn(web, actor, {
        renterId: businessId,
        vehicleId: await carWithPaperwork(),
        driverId,
      });
      expect((await startHandover(web.db, actor, booked.rentalId)).status).toBe("started");

      const changed = await nameRentalDriver(
        web.db,
        actor,
        booked.rentalId,
        { driverId: otherDriverId },
        CLOCK,
      );
      const cleared = await nameRentalDriver(
        web.db,
        actor,
        booked.rentalId,
        { driverId: null },
        CLOCK,
      );

      expect(changed.status).toBe("checklist_under_way");
      expect(cleared.status).toBe("checklist_under_way");
      expect(await driverOf(booked.rentalId)).toBe(driverId);
    });

    it("waits for a handover start holding the rental, then finds its checklist and refuses", async () => {
      const { businessId, driverId } = await businessWithDriver();
      const otherDriverId = await anotherDriver(businessId, "Kim Waiting");
      const booked = await bookTestRentalOn(web, actor, {
        renterId: businessId,
        vehicleId: await carWithPaperwork(),
        driverId,
      });
      const { client: starting, pid } = await openTransactionAs(actor.operatorId);
      try {
        // A handover's start: the rental locked, then its checklist added.
        await starting.query("select id from rentals where id = $1 for update", [booked.rentalId]);

        const naming = nameRentalDriver(
          web.db,
          actor,
          booked.rentalId,
          { driverId: otherDriverId },
          CLOCK,
        );
        await waitUntilBlockedBy(superuser, pid);
        await starting.query(
          `insert into inspections (operator_id, rental_id, vehicle_id, kind, photo_names, started_by_user_id)
           values ($1, $2, $3, 'handover', '{}', $4)`,
          [actor.operatorId, booked.rentalId, booked.vehicleId, actor.userId],
        );
        await starting.query("commit");

        expect((await naming).status).toBe("checklist_under_way");
        expect(await driverOf(booked.rentalId)).toBe(driverId);
      } finally {
        await starting.query("rollback").catch(() => undefined);
        await starting.end();
      }
    });

    it("names a driver only on a business's draft or booking", async () => {
      const personId = await addTestRenter(web, actor, "Person Booking");
      const own = await bookTestRentalOn(web, actor, {
        renterId: personId,
        vehicleId: await carWithPaperwork(),
      });

      expect(
        (await nameRentalDriver(web.db, actor, own.rentalId, { driverId: null }, CLOCK)).status,
      ).toBe("not_allowed");
    });

    it("refuses another Operator's rental, and another Operator's person as the driver", async () => {
      const { rentalId } = await bookingToBeNamed();
      const theirs = await businessWithDriver(otherActor, "Their Driver");

      const fromOther = await nameRentalDriver(
        web.db,
        otherActor,
        rentalId,
        {
          driverId: theirs.driverId,
        },
        CLOCK,
      );
      const otherPerson = await nameRentalDriver(
        web.db,
        actor,
        rentalId,
        {
          driverId: theirs.driverId,
        },
        CLOCK,
      );

      expect(fromOther.status).toBe("not_found");
      expect(otherPerson.status).toBe("driver_not_found");
      expect(await driverOf(rentalId)).toBeNull();
    });

    it("lists only the Operator's own businesses and drivers for the picker", async () => {
      const mine = await businessWithDriver();
      const theirs = await businessWithDriver(otherActor, "Hidden Driver");

      const choices = await listBusinessChoices(web.db, actor.operatorId, EXPIRY);

      expect(Object.keys(choices)).toContain(mine.businessId);
      expect(Object.keys(choices)).not.toContain(theirs.businessId);
      expect(JSON.stringify(choices)).not.toContain("Hidden Driver");
      expect(choices[mine.businessId]?.drivers.map((driver) => driver.driverId)).toEqual([
        mine.driverId,
      ]);
    });

    it("waits for a driver's removal that started first, then finds them no longer a driver", async () => {
      const { rentalId, businessId, driverId } = await bookingToBeNamed();
      const { client: removal, pid } = await openTransactionAs(actor.operatorId);
      try {
        // The removal's order: the business, then the driver, then the link (slice 2).
        await removal.query("select id from renters where id = $1 for update", [businessId]);
        await removal.query("select id from renters where id = $1 for update", [driverId]);

        const naming = nameRentalDriver(web.db, actor, rentalId, { driverId }, CLOCK);
        await waitUntilBlockedBy(superuser, pid);
        await removal.query(
          `update organisation_drivers set removed_at = now(), removed_by_user_id = $3
           where organisation_id = $1 and driver_id = $2 and removed_at is null`,
          [businessId, driverId, actor.userId],
        );
        await removal.query("commit");

        expect((await naming).status).toBe("driver_not_current");
        expect(await driverOf(rentalId)).toBeNull();
      } finally {
        await removal.query("rollback").catch(() => undefined);
        await removal.end();
      }
    });

    it("holds a driver's removal back while it names them, then the removal is refused", async () => {
      const { rentalId, businessId, driverId } = await bookingToBeNamed();
      const { client: naming, pid } = await openTransactionAs(actor.operatorId);
      try {
        // Naming locks the business, the driver, then the rental, as the handover does.
        await naming.query("select id from renters where id = $1 for update", [businessId]);
        await naming.query("select id from renters where id = $1 for update", [driverId]);
        await naming.query("select id from rentals where id = $1 for update", [rentalId]);

        const removing = removeDriver(web.db, actor, businessId, driverId);
        await waitUntilBlockedBy(superuser, pid);
        await naming.query("update rentals set driver_id = $2 where id = $1", [rentalId, driverId]);
        await naming.query("commit");

        expect(await removing).toBe("named_on_rental");
        expect(await driverOf(rentalId)).toBe(driverId);
      } finally {
        await naming.query("rollback").catch(() => undefined);
        await naming.end();
      }
    });
  });

  describe("the business contract and its authorised signing", () => {
    let owner: ActingUser;

    beforeAll(async () => {
      owner = await seedOperatorWithUser(admin, "Business Contracts Pty Ltd");
      // The business's own copy of a signed contract goes here.
      await superuser.query(
        "update operators set email = 'office@contracts.example.test' where id = $1",
        [owner.operatorId],
      );
    });

    async function bookedForBusiness() {
      const { businessId } = await businessWithDriver(owner);
      const vehicleId = await addTestCar(web, owner);
      const booked = await bookTestRentalOn(web, owner, { renterId: businessId, vehicleId });
      return booked.rentalId;
    }

    /** A Business rental contract template, the default unless one was written already. */
    async function writeBusinessTemplate(): Promise<void> {
      const templateId = await createTemplate(web.db, owner, {
        kind: "business_contract",
        name: "Business contract",
      });
      await saveTemplate(web.db, owner, templateId, {
        name: "Business contract",
        content: SHORT_BUSINESS_CONTRACT,
      });
    }

    /** The rental's signing link sent and opened: the visit, and the page as it shows. */
    async function openedSigningLink(rentalId: string) {
      const sent = await sendSigningLink(linkDeps(), owner, rentalId, CLOCK);
      expect(sent.status).toBe("sent");
      const token = TOKEN_PATTERN.exec(sent.status === "sent" ? sent.url : "")?.[1] ?? "";
      const visit = (await openLink(web.db, token))!;
      return { visit, view: await loadSigningView(web.db, visit) };
    }

    /** The signing form as the authorised person fills it, for the page it showed. */
    function signedFormFor(view: Awaited<ReturnType<typeof loadSigningView>>) {
      return {
        areDetailsConfirmed: "on",
        hasConsented: "on",
        method: "typed",
        typedName: "Dana Wells",
        drawnSignature: "",
        contractFingerprint: view.status === "ready" ? view.shownFingerprint : "",
        signerName: "Dana Wells",
        signerPosition: "Director",
        isAuthorised: "on",
      };
    }

    it("needs a Business rental contract template: a person's contract is never used", async () => {
      await createTemplate(web.db, owner, { kind: "contract", name: "Person's contract" });
      const rentalId = await bookedForBusiness();

      const result = await sendSigningLink(linkDeps(), owner, rentalId, CLOCK);

      expect(result.status).toBe("no_business_template");
    });

    it("is sent to the contact, signed by an authorised person with their position, kept as evidence", async () => {
      await writeBusinessTemplate();
      const rentalId = await bookedForBusiness();
      sentEmails.length = 0;

      const { visit, view } = await openedSigningLink(rentalId);
      expect(sentEmails[0]?.to).toBe(CONTACT_EMAIL);
      expect(sentEmails[0]?.text).toContain("Hi Dana Wells,");
      expect(view).toMatchObject({
        status: "ready",
        authority: { legalName: LEGAL_NAME },
        contactName: "Dana Wells",
      });
      expect(view.status === "ready" ? view.details.map(([label]) => label) : []).not.toContain(
        "Date of birth",
      );
      const values = signedFormFor(view);

      const withoutAuthority = await signContract(
        { ...linkDeps() },
        visit,
        { ...values, isAuthorised: "", signerPosition: "" },
        META,
      );
      const asTheBusiness = await signContract(
        linkDeps(),
        visit,
        { ...values, typedName: LEGAL_NAME },
        META,
      );
      const asTradingName = await signContract(
        linkDeps(),
        visit,
        { ...values, signerName: "acme rides", typedName: "acme rides" },
        META,
      );
      const signed = await signContract(linkDeps(), visit, values, META);

      expect(withoutAuthority.status).toBe("invalid");
      expect(asTheBusiness.status).toBe("invalid");
      expect(asTradingName.status).toBe("invalid");
      expect(signed.status).toBe("signed");
      const officeCopy = sentEmails.find((email) => email.subject.startsWith("Contract signed:"));
      expect(officeCopy?.subject).toContain(`Contract signed: ${LEGAL_NAME}, `);
      expect(officeCopy?.text).toContain(`Dana Wells signed ${LEGAL_NAME}'s contract`);
      const [evidence] = await withTenant(web.db, owner.operatorId, (tx) =>
        tx
          .select({ details: signingEvidence.details })
          .from(signingEvidence)
          .where(and(eq(signingEvidence.linkId, visit.linkId), eq(signingEvidence.step, "signed"))),
      );
      expect(evidence?.details).toMatchObject({
        signerName: "Dana Wells",
        signerPosition: "Director",
        authorityText: `I am authorised to sign for ${LEGAL_NAME}.`,
      });
    });

    it("emails a signed business contract again in the same words as when it was signed (second review)", async () => {
      await writeBusinessTemplate();
      const rentalId = await bookedForBusiness();
      const { visit, view } = await openedSigningLink(rentalId);
      const noEmail = {
        async send(): Promise<void> {
          throw new Error("The mail service is down");
        },
      };
      const signed = await signContract(
        { ...linkDeps(), emailSender: noEmail },
        visit,
        { ...signedFormFor(view), signerName: "Chris Park", typedName: "Chris Park" },
        META,
      );
      expect(signed.status).toBe("signed");
      const [contract] = await withTenant(web.db, owner.operatorId, (tx) =>
        tx
          .select({ id: issuedDocuments.id })
          .from(issuedDocuments)
          .where(and(eq(issuedDocuments.rentalId, rentalId), eq(issuedDocuments.kind, "contract"))),
      );
      sentEmails.length = 0;

      const again = await emailDocumentAgain(
        { ...linkDeps(), emailSender: recordingEmailSender(sentEmails) },
        owner,
        contract!.id,
        TEST_TIME_ZONE,
      );

      expect(again).toMatchObject({ status: "sent", state: { renter: "sent", business: "sent" } });
      const toSigner = sentEmails.find((email) => email.to === CONTACT_EMAIL);
      const toOffice = sentEmails.find((email) => email.to === "office@contracts.example.test");
      expect(toSigner?.text).toContain("Hi Chris Park,");
      expect(toSigner?.text).toContain(`the rental contract for ${LEGAL_NAME}`);
      expect(toOffice?.subject).toContain(`Contract signed: ${LEGAL_NAME}, `);
      expect(toOffice?.text).toContain(`Chris Park signed ${LEGAL_NAME}'s contract`);
    });

    it("refuses as changed when the business's names or details shown change before signing", async () => {
      const rentalId = await bookedForBusiness();
      const { visit, view } = await openedSigningLink(rentalId);
      const [rental] = await withTenant(web.db, owner.operatorId, (tx) =>
        tx.select({ renterId: rentals.renterId }).from(rentals).where(eq(rentals.id, rentalId)),
      );
      // Not in the contract's text: only the details rows and the authority show it.
      await superuser.query("update renters set trading_name = 'Acme Fleet' where id = $1", [
        rental!.renterId,
      ]);

      const result = await signContract(linkDeps(), visit, signedFormFor(view), META);

      expect(result.status).toBe("changed");
    });
  });

  describe("the driver signs for the car (rule 15)", () => {
    function kit() {
      return checklistKit(web, storage, sentEmails, actor);
    }

    async function signedBooking(withDriver: boolean) {
      const { businessId, driverId } = await businessWithDriver();
      const booked = await bookTestRentalOn(web, actor, {
        renterId: businessId,
        vehicleId: await carWithPaperwork(),
        ...(withDriver ? { driverId } : {}),
      });
      await kit().signAndHoldBond(booked.rentalId);
      return { ...booked, businessId, driverId };
    }

    /** The driver accepts on the phone, for the checklist as it stands unless told what it showed. */
    async function accept(inspectionId: string, typedName: string | null, shown?: string) {
      return completeHandover(
        kit().handoverDeps(),
        actor,
        inspectionId,
        {
          shownFingerprint: shown ?? (await kit().shown(inspectionId)),
          signature:
            typedName === null
              ? drawnSignatureInput(TEST_SIGNATURE)
              : { method: "typed", typedName, drawnSignature: "" },
          bondOverrideReason: null,
          directDebitOverrideReason: null,
          insuranceOverrideReason: null,
          regoOverrideReason: null,
        },
        { timeZone: TEST_TIME_ZONE, now: new Date() },
      );
    }

    /** What a completed paper's copies came to. */
    async function emailedTo(result: { status: string; documentId?: string }) {
      const documentId = result.documentId ?? "";
      return (await loadDocumentEmailStates(web.db, actor.operatorId, [documentId])).get(
        documentId,
      );
    }

    it("won't start a handover of a business's car with no driver named", async () => {
      const booked = await signedBooking(false);

      expect(await startHandover(web.db, actor, booked.rentalId)).toEqual({
        status: "driver_not_named",
      });
    });

    it("won't hand a business's car to nobody, even if its driver went from under a checklist", async () => {
      const booked = await signedBooking(true);
      const inspectionId = await kit().filledHandover(booked.rentalId);
      // Past every screen: the driver cleared straight in the database.
      await superuser.query("update rentals set driver_id = null where id = $1", [booked.rentalId]);

      const result = await accept(inspectionId, null);

      expect(result).toMatchObject({
        status: "blocked",
        problems: [{ code: "driver_not_named" }],
        isBusinessRental: true,
      });
    });

    it("refuses as changed when the driver changes after the phone showed the checklist", async () => {
      const booked = await signedBooking(true);
      const otherDriverId = await anotherDriver(booked.businessId, "Kim Other");
      const inspectionId = await kit().filledHandover(booked.rentalId);
      const shownFingerprint = await kit().shown(inspectionId);
      // Past every screen (naming is refused while the checklist is open): straight in the database.
      await superuser.query("update rentals set driver_id = $2 where id = $1", [
        booked.rentalId,
        otherDriverId,
      ]);

      const result = await accept(inspectionId, null, shownFingerprint);

      expect(result.status).toBe("changed");
      const held = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ id: possessions.id })
          .from(possessions)
          .where(eq(possessions.rentalId, booked.rentalId)),
      );
      expect(held).toEqual([]);
    });

    it("takes the driver's typed name, never the business's, and starts the driver's possession", async () => {
      const booked = await signedBooking(true);
      const inspectionId = await kit().filledHandover(booked.rentalId);
      sentEmails.length = 0;

      const asBusiness = await accept(inspectionId, LEGAL_NAME);
      const asDriver = await accept(inspectionId, "Sam Lee");

      expect(asBusiness.status).toBe("no_signature");
      expect(asDriver.status).toBe("completed");
      const [held] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ renterId: possessions.renterId, driverId: possessions.driverId })
          .from(possessions)
          .where(eq(possessions.rentalId, booked.rentalId)),
      );
      expect(held).toEqual({ renterId: booked.businessId, driverId: booked.driverId });
      const [checklist] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ acceptanceText: inspections.acceptanceText })
          .from(inspections)
          .where(eq(inspections.id, inspectionId)),
      );
      expect(checklist?.acceptanceText).toMatch(
        new RegExp(`^I, Sam Lee, received this car for ${LEGAL_NAME} on `),
      );
      const toContact = sentEmails.find(
        (email) => email.to === CONTACT_EMAIL && /handover/i.test(email.subject),
      );
      expect(toContact?.text).toContain(`Sam Lee received`);
      expect(toContact?.text).toContain(`for ${LEGAL_NAME}`);
      // The driver's own copy: to them alone, worded to them; their address goes nowhere else.
      const toDriver = sentEmails.filter((email) => email.to === DRIVER_EMAIL);
      expect(toDriver).toHaveLength(1);
      expect(toDriver[0]?.subject).toMatch(/handover report/);
      expect(toDriver[0]?.text).toContain("Hi Sam Lee,");
      expect(toDriver[0]?.text).toContain("You received");
      expect(toDriver[0]?.text).toContain(`for ${LEGAL_NAME}. The report you accepted`);
      expect(toDriver[0]?.attachments).toHaveLength(1);
      expect(
        sentEmails.filter((email) => email.to !== DRIVER_EMAIL).map((email) => email.text),
      ).not.toContainEqual(expect.stringContaining(DRIVER_EMAIL));
      expect(await emailedTo(asDriver)).toMatchObject({ renter: "sent", driver: "sent" });
      const rental = await loadRental(web.db, actor.operatorId, booked.rentalId, CLOCK);
      expect(rental).toMatchObject({ status: "active", driverFullName: "Sam Lee" });
    });

    it("has the driver sign the swap and the return, each by their own name, keeping them on the car", async () => {
      await createTemplate(web.db, actor, { kind: "swap_form", name: "Swap form" });
      const booked = await signedBooking(true);
      const handoverId = await kit().filledHandover(booked.rentalId);
      expect((await accept(handoverId, "Sam Lee")).status).toBe("completed");
      const newCarId = await addTestCar(web, actor);
      const started = await startSwap(
        web.db,
        actor,
        booked.rentalId,
        { toVehicleId: newCarId, reason: "Engine light on" },
        { timeZone: TEST_TIME_ZONE, now: new Date() },
      );
      const swapId = "swapId" in started ? started.swapId : "";
      const [swap] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select().from(carSwaps).where(eq(carSwaps.id, swapId)),
      );
      await kit().fillChecklist(swap!.returnInspectionId, HANDOVER_KM + 600);
      await kit().fillChecklist(swap!.handoverInspectionId, 12_050);
      const swapAs = async (typedName: string) =>
        completeSwap(
          kit().handoverDeps(),
          actor,
          booked.rentalId,
          {
            shown: (await currentShownSwap(
              { database: web.db },
              actor.operatorId,
              booked.rentalId,
              {
                timeZone: TEST_TIME_ZONE,
                now: new Date(),
              },
            ))!,
            signature: { method: "typed", typedName, drawnSignature: "" },
            oldCarAfter: { status: "available", statusReason: null, statusExpectedBack: null },
          },
          { timeZone: TEST_TIME_ZONE, now: new Date() },
        );

      expect((await swapAs(LEGAL_NAME)).status).toBe("no_signature");
      sentEmails.length = 0;
      expect((await swapAs("Sam Lee")).status).toBe("completed");
      // The driver's own copy of each of the swap's three papers.
      const swapCopies = sentEmails.filter((email) => email.to === DRIVER_EMAIL);
      expect(swapCopies.map((email) => email.subject).sort()).toEqual([
        expect.stringMatching(/^Your car handover report/),
        expect.stringMatching(/^Your car return report/),
        expect.stringMatching(/^Your car swap/),
      ]);
      expect(swapCopies.find((email) => /swap/.test(email.subject))?.text).toContain(
        `You swapped cars with Business Rentals Pty Ltd for ${LEGAL_NAME}: you now have`,
      );

      const returnStarted = await startReturn(web.db, actor, booked.rentalId);
      const returnId = "inspectionId" in returnStarted ? returnStarted.inspectionId : "";
      await kit().fillChecklist(returnId, 12_400);
      const returnAs = async (typedName: string) =>
        completeReturn(
          kit().handoverDeps(),
          actor,
          returnId,
          {
            shownFingerprint: await kit().shown(returnId),
            returnedAt: new Date(),
            signature: { method: "typed", typedName, drawnSignature: "" },
            carAfter: { status: "available", statusReason: null, statusExpectedBack: null },
          },
          { timeZone: TEST_TIME_ZONE, now: new Date() },
        );

      expect((await returnAs(LEGAL_NAME)).status).toBe("no_signature");
      sentEmails.length = 0;
      const returned = await returnAs("Sam Lee");
      expect(returned.status).toBe("completed");
      const returnCopies = sentEmails.filter((email) => email.to === DRIVER_EMAIL);
      expect(returnCopies).toHaveLength(1);
      expect(returnCopies[0]?.text).toContain("Hi Sam Lee,");
      expect(returnCopies[0]?.text).toContain(`for ${LEGAL_NAME}. The return report`);
      expect(await emailedTo(returned)).toMatchObject({ driver: "sent" });
      const held = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ driverId: possessions.driverId, endedAt: possessions.endedAt })
          .from(possessions)
          .where(eq(possessions.rentalId, booked.rentalId)),
      );
      expect(held).toHaveLength(2);
      expect(held.every((possession) => possession.driverId === booked.driverId)).toBe(true);
      expect(held.every((possession) => possession.endedAt !== null)).toBe(true);
      const [returnChecklist] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ acceptanceText: inspections.acceptanceText })
          .from(inspections)
          .where(eq(inspections.id, returnId)),
      );
      expect(returnChecklist?.acceptanceText).toMatch(
        new RegExp(`^I, Sam Lee, returned this car for ${LEGAL_NAME} on `),
      );
    });

    it("records a driver with no email as not sent, and the handover goes ahead", async () => {
      const booked = await signedBooking(true);
      // A driver added with a phone only (the Drivers tab allows it).
      await superuser.query("update renters set email = null where id = $1", [booked.driverId]);
      const inspectionId = await kit().filledHandover(booked.rentalId);
      sentEmails.length = 0;

      const result = await accept(inspectionId, null);

      expect(result.status).toBe("completed");
      expect(await emailedTo(result)).toEqual({
        renter: "sent",
        driver: "no_address",
        business: "no_address",
      });
      expect(sentEmails.map((email) => email.to)).not.toContain(DRIVER_EMAIL);
      expect(
        sentEmails
          .filter((email) => /handover report/.test(email.subject))
          .map((email) => email.to),
      ).toEqual([CONTACT_EMAIL]);
    });

    it("emails the driver's copy again when it didn't go, and only that copy", async () => {
      const booked = await signedBooking(true);
      const inspectionId = await kit().filledHandover(booked.rentalId);
      sentEmails.length = 0;
      const failingForDriver = {
        async send(message: EmailMessage) {
          if (message.to === DRIVER_EMAIL) {
            throw new Error("The driver's mailbox is full");
          }
          sentEmails.push(message);
        },
      };
      const result = await completeHandover(
        { ...kit().handoverDeps(), emailSender: failingForDriver },
        actor,
        inspectionId,
        {
          shownFingerprint: await kit().shown(inspectionId),
          signature: drawnSignatureInput(TEST_SIGNATURE),
          bondOverrideReason: null,
          directDebitOverrideReason: null,
          insuranceOverrideReason: null,
          regoOverrideReason: null,
        },
        { timeZone: TEST_TIME_ZONE, now: new Date() },
      );
      expect(await emailedTo(result)).toMatchObject({ renter: "sent", driver: "failed" });
      sentEmails.length = 0;

      const again = await emailDocumentAgain(
        kit().handoverDeps(),
        actor,
        result.status === "completed" ? result.documentId : "",
        TEST_TIME_ZONE,
      );

      expect(again).toMatchObject({ status: "sent", state: { driver: "sent" } });
      expect(sentEmails.map((email) => email.to)).toEqual([DRIVER_EMAIL]);
      expect(sentEmails[0]?.text).toContain("Hi Sam Lee,");
      expect(sentEmails[0]?.text).toContain(`for ${LEGAL_NAME}. The report you accepted`);
      expect(await emailedTo(result)).toEqual({
        renter: "sent",
        driver: "sent",
        business: "no_address",
      });
    });

    it("hands the car over when the handover takes the rental first; naming a driver then is refused", async () => {
      const booked = await signedBooking(true);
      const otherDriverId = await anotherDriver(booked.businessId, "Kim Other");
      const inspectionId = await kit().filledHandover(booked.rentalId);
      const shownFingerprint = await kit().shown(inspectionId);
      // Holding the checklist: the handover takes the rental, then waits here.
      const holder = await openTransactionAs(actor.operatorId);
      await holder.client.query("select id from inspections where id = $1 for update", [
        inspectionId,
      ]);
      const handedOver = accept(inspectionId, null, shownFingerprint);
      await waitUntilBlockedBy(superuser, holder.pid);
      // Naming waits for the rental too, holding neither the business nor the driver the handover needs.
      const naming = nameRentalDriver(
        web.db,
        actor,
        booked.rentalId,
        { driverId: otherDriverId },
        CLOCK,
      );
      await waitUntilBlockedBy(superuser, holder.pid, 2);
      await holder.client.query("commit");
      await holder.client.end();

      expect((await handedOver).status).toBe("completed");
      expect(await naming).toEqual({ status: "not_allowed" });
      expect(await driverOf(booked.rentalId)).toBe(booked.driverId);
    });

    it("refuses naming a driver that reached the rental first while its checklist is open; the handover then goes ahead", async () => {
      const booked = await signedBooking(true);
      const otherDriverId = await anotherDriver(booked.businessId, "Kim Other");
      const inspectionId = await kit().filledHandover(booked.rentalId);
      const shownFingerprint = await kit().shown(inspectionId);
      // Holding the rental: the naming queues for it first, the handover after it.
      const holder = await openTransactionAs(actor.operatorId);
      await holder.client.query("select id from rentals where id = $1 for update", [
        booked.rentalId,
      ]);
      const naming = nameRentalDriver(
        web.db,
        actor,
        booked.rentalId,
        { driverId: otherDriverId },
        CLOCK,
      );
      await waitUntilBlockedBy(superuser, holder.pid);
      const handedOver = accept(inspectionId, null, shownFingerprint);
      await waitUntilBlockedBy(superuser, holder.pid, 2);
      await holder.client.query("commit");
      await holder.client.end();

      expect(await naming).toEqual({ status: "checklist_under_way" });
      expect((await handedOver).status).toBe("completed");
      expect(await driverOf(booked.rentalId)).toBe(booked.driverId);
    });

    it("says the driver's licence problems as the driver's, on the rental's checks", async () => {
      const booked = await signedBooking(true);
      // A licence that ran out before the start: the driver's, checked for the business's car.
      await superuser.query("update renters set licence_expires_on = '2027-01-01' where id = $1", [
        booked.driverId,
      ]);
      const rental = (await loadRental(web.db, actor.operatorId, booked.rentalId, CLOCK))!;

      const problems = await loadRentalProblems(web.db, actor.operatorId, rental, CLOCK);

      const expired = Array.isArray(problems)
        ? problems.find((problem) => problem.code === "licence_expired_by_start")
        : undefined;
      expect(expired).toBeDefined();
      expect(bookingProblemMessage(expired!, true)).toMatch(/^The driver's licence expires on /);
    });
  });
});
