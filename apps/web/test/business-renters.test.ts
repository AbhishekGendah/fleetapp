import { parseListQuery } from "@fleetapp/core";
import { activityLog, files, organisationDrivers, rentals, renters } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { RENTER_LIST } from "../src/app/renters/renter-list";
import type { ActingUser } from "../src/lib/acting-user";
import type { FileDependencies } from "../src/lib/files/stored-files";
import { listPickableRenters } from "../src/lib/rentals/pickable-records";
import { sendDetailsLink } from "../src/lib/renter-links/details-links";
import {
  emptyBusinessRenterForm,
  parseBusinessRenterForm,
  type BusinessRenterFormValues,
  type BusinessRenterInput,
} from "../src/lib/renters/business-renter-input";
import { parseAddDriverForm } from "../src/lib/renters/driver-input";
import { buildEverythingHeld } from "../src/lib/renters/everything-held";
import { saveLicence } from "../src/lib/renters/licence-records";
import { parseLicenceForm, type LicenceInput } from "../src/lib/renters/licence-input";
import { startLicenceScanUpload } from "../src/lib/renters/licence-scans";
import {
  countCurrentDriverLinks,
  listBusinessDrivers,
  listDriverCandidates,
  listDrivesFor,
  loadCurrentBusinessesOf,
} from "../src/lib/renters/organisation-driver-queries";
import {
  addExistingDriver,
  addNewDriver,
  removeDriver,
} from "../src/lib/renters/organisation-driver-records";
import { loadRenterListExtras } from "../src/lib/renters/renter-list-extras";
import { renterListRows } from "../src/lib/renters/renter-list-rows";
import { countRentersByFilter, listRenterPage } from "../src/lib/renters/renter-queries";
import {
  archiveRenter,
  changeRenterStatus,
  createBusinessRenter,
  restoreRenter,
  updateBusinessRenter,
  updateRenter,
} from "../src/lib/renters/renter-records";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { searchOperatorRecords } from "../src/lib/search/header-search-queries";
import { createMemoryFileStorage } from "../src/lib/storage/memory-file-storage";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { recordingEmailSender } from "./renter-link-fixtures";
import { addTestRenter, TEST_TIME_ZONE } from "./rental-fixtures";

const TODAY = "2026-11-08";
const ABN = "51824753556";
const CLOCK = { timeZone: TEST_TIME_ZONE, now: new Date("2026-11-08T02:00:00Z") };
const EXPIRY = { today: TODAY, warningDays: 30 };
/** A driver's licence number: never in what is held about the business they drive for. */
const DRIVER_LICENCE_NUMBER = "WA7766554";
const SCAN = { contentType: "image/jpeg", sizeBytes: 300_000 };

function businessInput(changes: Partial<BusinessRenterFormValues> = {}): BusinessRenterInput {
  const parsed = parseBusinessRenterForm({
    ...emptyBusinessRenterForm(),
    fullName: "Acme Rideshare Pty Ltd",
    tradingName: "Acme Rides",
    abn: "51 824 753 556",
    contactName: "Dana Wells",
    email: "Dana.Wells@Example.TEST",
    phone: "0491576398",
    businessAddress: "Unit 4, 12 Example Road, Osborne Park WA 6017",
    ...changes,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data;
}

describe("the business Renter form's rules", () => {
  it("needs the legal name, a valid ABN, and the contact's name and email", () => {
    const blank = parseBusinessRenterForm(emptyBusinessRenterForm());
    expect(blank.success).toBe(false);
    expect(Object.keys(blank.error?.flatten().fieldErrors ?? {}).sort()).toEqual(
      ["abn", "contactName", "email", "fullName"].sort(),
    );
    expect(
      parseBusinessRenterForm({
        ...emptyBusinessRenterForm(),
        abn: "51 824 753 557",
      }).error?.flatten().fieldErrors.abn,
    ).toEqual(["That is not a valid ABN. Check the 11 digits."]);
  });

  it("keeps the ABN as digits, the email in lower case, and a same trading name as none", () => {
    expect(businessInput()).toMatchObject({
      abn: ABN,
      email: "dana.wells@example.test",
      phone: "0491 576 398",
      postalAddress: null,
    });
    expect(businessInput({ tradingName: "Acme Rideshare Pty Ltd" }).tradingName).toBeNull();
  });

  it("asks a new driver only for a name and a phone or email, or a pick", () => {
    const values = { source: "new", driverId: "", fullName: "Sam Lee", phone: "", email: "" };
    expect(parseAddDriverForm(values, TODAY).success).toBe(false);
    expect(parseAddDriverForm({ ...values, email: "sam@example.test" }, TODAY).data).toMatchObject({
      source: "new",
      person: { fullName: "Sam Lee", email: "sam@example.test", dateOfBirth: null },
    });
    expect(parseAddDriverForm({ ...values, source: "existing" }, TODAY).success).toBe(false);
  });
});

describe("business Renters and their drivers", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: Client;
  let actor: ActingUser;
  let otherActor: ActingUser;
  const sentEmails: EmailMessage[] = [];

  async function addBusiness(owner = actor, changes: Partial<BusinessRenterFormValues> = {}) {
    return createBusinessRenter(web.db, owner, businessInput(changes));
  }

  /** A business's booking naming this driver, made as slice 3 will (the database checks it). */
  async function bookingNaming(organisationId: string, driverId: string): Promise<string> {
    const vehicleId = await addTestCar(web, actor);
    const [rental] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .insert(rentals)
        .values({
          operatorId: actor.operatorId,
          renterId: organisationId,
          driverId,
          vehicleId,
          type: "fixed_term",
          status: "booked",
          plannedStart: new Date("2027-03-01T01:00:00Z"),
          plannedEnd: new Date("2027-03-29T01:00:00Z"),
          chargeWeekday: 1,
          bondCents: 0,
          settingsSnapshot: {},
          settingsVersion: 1,
        })
        .returning({ id: rentals.id }),
    );
    return rental!.id;
  }

  async function cancel(rentalId: string): Promise<void> {
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .update(rentals)
        .set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: "Test" })
        .where(eq(rentals.id, rentalId)),
    );
  }

  async function logOf(entityId: string) {
    return withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ action: activityLog.action, valuesAfter: activityLog.valuesAfter })
        .from(activityLog)
        .where(
          and(eq(activityLog.operatorId, actor.operatorId), eq(activityLog.entityId, entityId)),
        ),
    );
  }

  function driverLicence(): LicenceInput {
    const licence = parseLicenceForm({
      licenceIssuedIn: "WA",
      licenceCountry: "",
      licenceNumber: DRIVER_LICENCE_NUMBER,
      licenceClass: "C",
      licenceType: "full",
      licenceExpiresOn: "2029-06-03",
    });
    if (!licence.success) {
      throw new Error(licence.error.message);
    }
    return licence.data;
  }

  async function personWithLicence(fullName: string): Promise<string> {
    const renterId = await addTestRenter(web, actor, fullName, "0491570006");
    expect(await saveLicence(web.db, actor, renterId, driverLicence())).toBe("saved");
    return renterId;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    actor = await seedOperatorWithUser(admin, "Business Renters Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Business Renters Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.end()]);
  });

  describe("adding and editing a business", () => {
    it("adds it as a business, logging what was added but never its details", async () => {
      const businessId = await addBusiness();
      const [row] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select().from(renters).where(eq(renters.id, businessId)),
      );
      expect(row).toMatchObject({ kind: "organisation", abn: ABN, contactName: "Dana Wells" });
      const [created] = await logOf(businessId);
      expect(created?.action).toBe("created");
      expect(JSON.stringify(created?.valuesAfter)).not.toContain("Dana");
      expect(JSON.stringify(created?.valuesAfter)).not.toContain(ABN);
    });

    it("edits only a business with the business form, and a person with the person form", async () => {
      const businessId = await addBusiness();
      const personId = await addTestRenter(web, actor, "Pat Person");
      const person = parseRenterForm(
        { ...emptyRenterForm(), fullName: "Pat", phone: "0412345678" },
        TODAY,
      ).data!;
      expect(await updateRenter(web.db, actor, businessId, person)).toBe("not_found");
      expect(await updateBusinessRenter(web.db, actor, personId, businessInput())).toBe(
        "not_found",
      );
      expect(
        await updateBusinessRenter(
          web.db,
          actor,
          businessId,
          businessInput({ tradingName: "Acme" }),
        ),
      ).toBe("changed");
      const entries = await logOf(businessId);
      expect(entries.map((entry) => entry.action)).toContain("updated");
    });

    it("never sends a business a details link: it has no form of its own", async () => {
      const businessId = await addBusiness();
      const result = await sendDetailsLink(
        {
          database: web.db,
          emailSender: recordingEmailSender(sentEmails),
          now: () => new Date(),
          appUrl: "https://app.example.test",
          describeDay: (moment) => moment.toISOString().slice(0, 10),
          describeMoment: (moment) => moment.toISOString().slice(0, 16),
        },
        actor,
        businessId,
        7,
      );
      expect(result.status).toBe("not_found");
    });

    it("refuses a licence or a licence scan for a business, with nothing saved", async () => {
      const businessId = await addBusiness();
      expect(await saveLicence(web.db, actor, businessId, driverLicence())).toBe("not_a_person");
      const deps: FileDependencies = {
        database: web.db,
        storage: createMemoryFileStorage(),
        now: () => new Date(),
      };
      expect(await startLicenceScanUpload(deps, actor, businessId, "front", SCAN)).toEqual({
        status: "not_a_person",
      });
      const held = await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select({ id: files.id }).from(files).where(eq(files.renterId, businessId)),
      );
      expect(held).toEqual([]);
    });

    it("isn't offered on the New rental form until renting to a business is built", async () => {
      const businessId = await addBusiness();
      const picked = await listPickableRenters(web.db, actor.operatorId);
      expect(picked.map((record) => record.value)).not.toContain(businessId);
    });
  });

  describe("its drivers", () => {
    it("adds a person already on file, once, and logs the link", async () => {
      const businessId = await addBusiness();
      const driverId = await addTestRenter(web, actor, "Sam Lee");
      expect(await addExistingDriver(web.db, actor, businessId, driverId)).toEqual({
        status: "added",
        driverId,
      });
      expect(await addExistingDriver(web.db, actor, businessId, driverId)).toEqual({
        status: "refused",
        problem: "already_a_driver",
      });
      const { drivers } = await listBusinessDrivers(web.db, actor.operatorId, businessId);
      expect(drivers.map((driver) => driver.fullName)).toEqual(["Sam Lee"]);
      const [link] = drivers;
      const entries = await logOf(link!.linkId);
      expect(entries).toMatchObject([
        { action: "created", valuesAfter: { organisationId: businessId, driverId } },
      ]);
    });

    it("adds someone new as a person Renter and its driver in one step", async () => {
      const businessId = await addBusiness();
      const person = parseRenterForm(
        { ...emptyRenterForm(), fullName: "Priya Singh", email: "priya@example.test" },
        TODAY,
      ).data!;
      const result = await addNewDriver(web.db, actor, businessId, person);
      expect(result.status).toBe("added");
      const drivesFor = await listDrivesFor(
        web.db,
        actor.operatorId,
        result.status === "added" ? result.driverId : "",
      );
      expect(drivesFor.map((link) => link.name)).toEqual(["Acme Rides"]);
    });

    it("refuses a business, an archived or Do not rent person as a driver", async () => {
      const businessId = await addBusiness();
      const otherBusinessId = await addBusiness();
      const archivedId = await addTestRenter(web, actor, "Archie Archived");
      await archiveRenter(web.db, actor, archivedId);
      const refusedId = await addTestRenter(web, actor, "Dee Notrent");
      await changeRenterStatus(web.db, actor, refusedId, {
        status: "do_not_rent",
        doNotRentReason: "Unpaid tolls",
      });
      const problemOf = async (driverId: string) => {
        const result = await addExistingDriver(web.db, actor, businessId, driverId);
        return result.status === "refused" ? result.problem : result.status;
      };
      expect(await problemOf(otherBusinessId)).toBe("not_a_person");
      expect(await problemOf(archivedId)).toBe("archived");
      expect(await problemOf(refusedId)).toBe("do_not_rent");
      const candidates = await listDriverCandidates(web.db, actor.operatorId, businessId);
      expect(candidates.map((record) => record.value)).not.toEqual(
        expect.arrayContaining([archivedId]),
      );
      expect(candidates.map((record) => record.value)).not.toContain(refusedId);
      expect(candidates.map((record) => record.value)).not.toContain(otherBusinessId);
    });

    it("removes a driver, keeping the history, but not while a booking names them", async () => {
      const businessId = await addBusiness();
      const driverId = await addTestRenter(web, actor, "Leo Martins");
      await addExistingDriver(web.db, actor, businessId, driverId);
      const rentalId = await bookingNaming(businessId, driverId);
      expect(await removeDriver(web.db, actor, businessId, driverId)).toBe("named_on_rental");
      await cancel(rentalId);
      expect(await removeDriver(web.db, actor, businessId, driverId)).toBe("removed");
      expect(await removeDriver(web.db, actor, businessId, driverId)).toBe("not_found");
      const { drivers } = await listBusinessDrivers(web.db, actor.operatorId, businessId);
      expect(drivers).toHaveLength(1);
      expect(drivers[0]?.removedAt).not.toBeNull();
      const entries = await logOf(drivers[0]!.linkId);
      expect(entries.map((entry) => entry.action).sort()).toEqual(["created", "removed"]);
    });
  });

  describe("archive and Do not rent", () => {
    it("refuses archiving a business with drivers, or a person who drives for one, with a reason", async () => {
      const businessId = await addBusiness();
      const driverId = await addTestRenter(web, actor, "Mia Thompson");
      await addExistingDriver(web.db, actor, businessId, driverId);
      expect(await archiveRenter(web.db, actor, businessId)).toBe("has_drivers");
      expect(await archiveRenter(web.db, actor, driverId)).toBe("drives_for");
      await removeDriver(web.db, actor, businessId, driverId);
      expect(await archiveRenter(web.db, actor, driverId)).toBe("changed");
      expect(await archiveRenter(web.db, actor, businessId)).toBe("changed");
      expect(await restoreRenter(web.db, actor, businessId)).toBe("changed");
    });

    it("refuses archiving while a booking of the business is under way", async () => {
      const businessId = await addBusiness();
      const driverId = await addTestRenter(web, actor, "Jack O'Neill");
      await addExistingDriver(web.db, actor, businessId, driverId);
      await bookingNaming(businessId, driverId);
      expect(await archiveRenter(web.db, actor, businessId)).toBe("in_use");
    });

    it("marks a business Do not rent without touching its drivers", async () => {
      const businessId = await addBusiness();
      const driverId = await addTestRenter(web, actor, "Ella Wright");
      await addExistingDriver(web.db, actor, businessId, driverId);
      expect(
        await changeRenterStatus(web.db, actor, businessId, {
          status: "do_not_rent",
          doNotRentReason: "Three failed debits",
        }),
      ).toBe("changed");
      const [driver] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select({ status: renters.status }).from(renters).where(eq(renters.id, driverId)),
      );
      expect(driver?.status).toBe("active");
      expect(
        await withTenant(web.db, actor.operatorId, (tx) =>
          countCurrentDriverLinks(tx, actor.operatorId, businessId),
        ),
      ).toBe(1);
    });
  });

  describe("the Renters list and search", () => {
    let businessId: string;
    let driverId: string;

    beforeAll(async () => {
      businessId = await addBusiness(actor, { tradingName: "Zebra Fleet", abn: "53 004 085 616" });
      driverId = await addTestRenter(web, actor, "Zara Driver");
      await addExistingDriver(web.db, actor, businessId, driverId);
    });

    async function namesFound(search: string, status?: string): Promise<string[]> {
      const page = await listRenterPage(
        web.db,
        actor.operatorId,
        parseListQuery(RENTER_LIST, { q: search, ...(status ? { status } : {}) }),
      );
      return page.rows.map((row) => row.id);
    }

    it("finds a business by trading name, legal name, contact, and ABN with or without spaces", async () => {
      expect(await namesFound("zebra")).toEqual([businessId]);
      expect(await namesFound("53004085616")).toEqual([businessId]);
      expect(await namesFound("53 004 085 616")).toEqual([businessId]);
      expect(await namesFound("dana wells")).toContain(businessId);
    });

    it("filters Businesses and Drivers, and counts them", async () => {
      expect(await namesFound("zebra", "businesses")).toEqual([businessId]);
      expect(await namesFound("zara", "drivers")).toEqual([driverId]);
      expect(await namesFound("zara", "businesses")).toEqual([]);
      const counts = await countRentersByFilter(web.db, actor.operatorId);
      expect(counts.businesses).toBeGreaterThan(0);
      expect(counts.drivers).toBeGreaterThan(0);
    });

    it("labels a business and a driver, with the business by its trading name", async () => {
      const page = await listRenterPage(
        web.db,
        actor.operatorId,
        parseListQuery(RENTER_LIST, { q: "z" }),
      );
      const rows = renterListRows(
        page.rows,
        await loadRenterListExtras(
          web.db,
          actor.operatorId,
          page.rows.map((row) => row.id),
          CLOCK,
        ),
        EXPIRY,
        CLOCK,
      );
      expect(rows.find((row) => row.id === businessId)).toMatchObject({
        shownName: "Zebra Fleet",
        kindLabels: ["Business"],
      });
      expect(rows.find((row) => row.id === driverId)?.kindLabels).toEqual([
        "Driver for Zebra Fleet",
      ]);
    });

    it("finds a business in the top bar by trading name and ABN, shown by its trading name", async () => {
      const byName = await searchOperatorRecords(web.db, actor.operatorId, "Zebra");
      expect(byName.renters).toEqual([
        { id: businessId, shownName: "Zebra Fleet", detail: "Acme Rideshare Pty Ltd" },
      ]);
      const byAbn = await searchOperatorRecords(web.db, actor.operatorId, "53 004 085 616");
      expect(byAbn.renters.map((renter) => renter.id)).toEqual([businessId]);
    });
  });

  describe("everything held", () => {
    it("holds a business's details and its drivers' names, never a driver's licence", async () => {
      const businessId = await addBusiness();
      const driverId = await personWithLicence("Sam Licensed");
      await addExistingDriver(web.db, actor, businessId, driverId);
      await bookingNaming(businessId, driverId);
      const held = await buildEverythingHeld(web.db, actor, businessId, TEST_TIME_ZONE);
      const names = held?.sheets.map((sheet) => sheet.name) ?? [];
      expect(names).toContain("Drivers");
      expect(names).not.toContain("Licence");
      const cells = JSON.stringify(held?.sheets);
      expect(cells).toContain("Acme Rides");
      expect(cells).toContain("51 824 753 556");
      expect(cells).toContain("Sam Licensed");
      expect(cells).not.toContain(DRIVER_LICENCE_NUMBER);
      expect(held?.files.some((file) => file.path.startsWith("licence-scans/"))).toBe(false);
    });

    it("never sends a scan with a business's, even one stored against it before refusals", async () => {
      const businessId = await addBusiness();
      await withTenant(web.db, actor.operatorId, (tx) =>
        tx.insert(files).values({
          operatorId: actor.operatorId,
          purpose: "renter_licence_scan",
          storageArea: "identity",
          objectKey: `test/${crypto.randomUUID()}`,
          contentType: "image/jpeg",
          sizeBytes: SCAN.sizeBytes,
          renterId: businessId,
          licenceSide: "front",
          confirmedAt: new Date(),
        }),
      );
      const held = await buildEverythingHeld(web.db, actor, businessId, TEST_TIME_ZONE);
      expect(held?.files.some((file) => file.path.startsWith("licence-scans/"))).toBe(false);
      const scans = held?.sheets.find((sheet) => sheet.name === "Licence scans");
      expect(scans?.table).toHaveLength(1);
    });

    it("holds the businesses a driver drives for", async () => {
      const businessId = await addBusiness();
      const driverId = await addTestRenter(web, actor, "Sam Driving");
      await addExistingDriver(web.db, actor, businessId, driverId);
      const held = await buildEverythingHeld(web.db, actor, driverId, TEST_TIME_ZONE);
      const drivesFor = held?.sheets.find((sheet) => sheet.name === "Drives for");
      expect(drivesFor?.table[1]?.[0]).toBe("Acme Rides");
    });
  });

  describe("tenant isolation", () => {
    it("never shows, links or removes another Operator's business or drivers", async () => {
      const businessId = await addBusiness();
      const driverId = await addTestRenter(web, actor, "Kept Apart");
      await addExistingDriver(web.db, actor, businessId, driverId);
      const othersBusinessId = await addBusiness(otherActor);
      const othersPersonId = await addTestRenter(web, otherActor, "Other Person");

      expect(await listBusinessDrivers(web.db, otherActor.operatorId, businessId)).toEqual({
        drivers: [],
        carsOut: [],
      });
      expect(await listDrivesFor(web.db, otherActor.operatorId, driverId)).toEqual([]);
      expect(await loadCurrentBusinessesOf(web.db, otherActor.operatorId, [driverId])).toEqual(
        new Map(),
      );
      // Another Operator can't add to, or take from, this one's business.
      expect((await addExistingDriver(web.db, otherActor, businessId, othersPersonId)).status).toBe(
        "business_not_found",
      );
      expect(await removeDriver(web.db, otherActor, businessId, driverId)).toBe("not_found");
      // Nor link this one's person to its own business.
      expect((await addExistingDriver(web.db, otherActor, othersBusinessId, driverId)).status).toBe(
        "driver_not_found",
      );
      expect(await updateBusinessRenter(web.db, otherActor, businessId, businessInput())).toBe(
        "not_found",
      );
      const found = await searchOperatorRecords(web.db, otherActor.operatorId, "Kept Apart");
      expect(found.renters).toEqual([]);
      const candidates = await listDriverCandidates(
        web.db,
        otherActor.operatorId,
        othersBusinessId,
      );
      expect(candidates.map((record) => record.value)).not.toContain(driverId);
      const links = await withTenant(web.db, otherActor.operatorId, (tx) =>
        tx.select().from(organisationDrivers),
      );
      expect(links.every((link) => link.operatorId === otherActor.operatorId)).toBe(true);
    });
  });

  describe("removing a driver while a booking names them, at the same moment", () => {
    it("waits for the booking (business, then driver, then link), then is refused", async () => {
      const businessId = await addBusiness();
      const driverId = await addTestRenter(web, actor, "Two Connections");
      await addExistingDriver(web.db, actor, businessId, driverId);
      const vehicleId = await addTestCar(web, actor);
      const booking = new Client({ connectionString: inject("webAppRoleUrl") });
      await booking.connect();
      try {
        await booking.query("set lock_timeout = '5s'");
        const pid = (await booking.query<{ pid: number }>("select pg_backend_pid() as pid"))
          .rows[0]!.pid;
        await booking.query("begin");
        await booking.query("select set_config('app.operator_id', $1, true)", [actor.operatorId]);
        // A booking locks the business, then the driver, as the booking checks do.
        await booking.query("select id from renters where id = $1 for update", [businessId]);
        await booking.query("select id from renters where id = $1 for update", [driverId]);

        const removing = removeDriver(web.db, actor, businessId, driverId);
        await waitUntilBlockedBy(pid);
        // Naming the driver takes the link (shared): it must not wait on the removal.
        await booking.query(
          `insert into rentals (operator_id, renter_id, driver_id, vehicle_id, type, status,
             planned_start, planned_end, charge_weekday, bond_cents, settings_snapshot, settings_version)
           values ($1, $2, $3, $4, 'fixed_term', 'booked', '2027-05-01T01:00:00Z',
             '2027-05-29T01:00:00Z', 1, 0, '{}', 1)`,
          [actor.operatorId, businessId, driverId, vehicleId],
        );
        await booking.query("commit");

        expect(await removing).toBe("named_on_rental");
      } finally {
        await booking.query("rollback").catch(() => undefined);
        await booking.end();
      }
    });
  });

  /** Resolves once some connection waits on a lock the given backend holds. */
  async function waitUntilBlockedBy(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 250; attempt += 1) {
      const result = await superuser.query<{ waiting: number }>(
        "select count(*)::int as waiting from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
        [pid],
      );
      if ((result.rows[0]?.waiting ?? 0) > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("The removal never waited for the booking.");
  }
});
