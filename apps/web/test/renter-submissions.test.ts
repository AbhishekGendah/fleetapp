import { MAXIMUM_LINK_ADDRESS_SEARCHES, type LicenceSide } from "@fleetapp/core";
import { activityLog, files, renters } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailSender } from "@fleetapp/email";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { confirmUpload, type FileDependencies } from "../src/lib/files/stored-files";
import {
  detailsFormStart,
  parseDetailsForm,
  type DetailsInput,
} from "../src/lib/renter-links/details-form-input";
import { sendDetailsLink, type LinkDependencies } from "../src/lib/renter-links/details-links";
import { openLink, type LinkVisit } from "../src/lib/renter-links/link-visits";
import {
  countAddressSearch,
  loadFormStart,
  loadWaitingSubmission,
  startLinkPhotoUpload,
  submitDetails,
} from "../src/lib/renter-links/submissions";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { createRenter } from "../src/lib/renters/renter-records";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";

const TODAY = "2026-10-31";
const JPEG_START = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PHOTO = { contentType: "image/jpeg", sizeBytes: 300_000 };
const NO_EMAIL: EmailSender = { send: async () => undefined };

describe("what a Renter sends through their details link", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let fileDeps: FileDependencies;
  let linkDeps: LinkDependencies;
  let actor: ActingUser;
  let otherActor: ActingUser;

  /** A Renter started from a phone call, and the link they were sent. */
  async function openRenterLink(): Promise<LinkVisit> {
    const parsed = parseRenterForm(
      { ...emptyRenterForm(), fullName: "Sam Example", email: "sam@example.test" },
      TODAY,
    );
    const renterId = await createRenter(web.db, actor, parsed.data!);
    const result = await sendDetailsLink(linkDeps, actor, renterId, 7);
    if (result.status !== "sent") {
      throw new Error(result.status);
    }
    return (await openLink(web.db, result.url.split("/r/")[1]!))!;
  }

  async function addPhoto(visit: LinkVisit, side: LicenceSide): Promise<string> {
    const start = await startLinkPhotoUpload(fileDeps, visit, side, PHOTO);
    if (start.status !== "allowed") {
      throw new Error(`The photo was not allowed: ${start.status}`);
    }
    const permission = storage.permissions.at(-1)!;
    storage.receive(permission.area, permission.key, JPEG_START);
    expect(permission.area).toBe("identity");
    const linkActor = { operatorId: visit.operatorId, linkId: visit.linkId };
    expect(await confirmUpload(fileDeps, linkActor, start.fileId)).toBe("confirmed");
    return start.fileId;
  }

  function detailsSent(): DetailsInput {
    const parsed = parseDetailsForm(
      {
        ...detailsFormStart({ ...emptyRenterForm(), fullName: "Sam Example" }),
        email: "sam@example.test",
        dateOfBirth: "1990-04-02",
        residentialAddress: "1 Example St, Perth WA 6000",
        licenceIssuedIn: "WA",
        licenceNumber: "1234567",
        licenceExpiresOn: "2029-01-01",
      },
      TODAY,
    );
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.errors));
    }
    return parsed.data;
  }

  async function livePhotos(visit: LinkVisit) {
    return withTenant(web.db, visit.operatorId, (tx) =>
      tx
        .select({ id: files.id, side: files.licenceSide, submissionId: files.submissionId })
        .from(files)
        .where(and(eq(files.renterLinkId, visit.linkId), isNull(files.deletedAt))),
    );
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    fileDeps = { database: web.db, storage, now: () => new Date() };
    linkDeps = {
      database: web.db,
      emailSender: NO_EMAIL,
      now: () => new Date(),
      appUrl: "https://app.example.test",
      describeDay: (moment) => moment.toISOString().slice(0, 10),
    };
    actor = await seedOperatorWithUser(admin, "Submissions Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Submissions Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("needs date of birth, home address and the whole licence to send", () => {
    const start = detailsFormStart({ ...emptyRenterForm(), fullName: "Sam Example" });
    const parsed = parseDetailsForm({ ...start, phone: "0412345678" }, TODAY);
    expect(parsed.success).toBe(false);
    expect(Object.keys(parsed.success ? {} : parsed.errors)).toEqual(
      expect.arrayContaining([
        "dateOfBirth",
        "residentialAddress",
        "licenceIssuedIn",
        "licenceNumber",
        "licenceExpiresOn",
      ]),
    );
  });

  it("starts from the details on file, never the licence", async () => {
    const visit = await openRenterLink();
    const start = await loadFormStart(web.db, visit);
    if (start.status !== "open") {
      throw new Error(start.status);
    }
    expect(start.values).toMatchObject({ fullName: "Sam Example", email: "sam@example.test" });
    expect(start.photos).toEqual({ front: false, back: false });
    expect(detailsFormStart(start.values)).toMatchObject({ licenceNumber: "", licenceClass: "C" });
  });

  it("keeps one photo per side: a new one replaces the last", async () => {
    const visit = await openRenterLink();
    await addPhoto(visit, "front");
    const keeper = await addPhoto(visit, "front");
    expect(await livePhotos(visit)).toEqual([{ id: keeper, side: "front", submissionId: null }]);
    expect(await loadFormStart(web.db, visit)).toMatchObject({
      photos: { front: true, back: false },
    });
  });

  it("sends only with both photos, changes nothing on the Renter, and can be sent once", async () => {
    const visit = await openRenterLink();
    await addPhoto(visit, "front");
    expect(await submitDetails(web.db, visit, detailsSent())).toBe("photos_missing");
    await addPhoto(visit, "back");
    expect(await submitDetails(web.db, visit, detailsSent())).toBe("sent");

    const [renter] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(renters).where(eq(renters.id, visit.renterId)),
    );
    expect(renter).toMatchObject({ dateOfBirth: null, licenceNumber: null });
    expect((await livePhotos(visit)).every((photo) => photo.submissionId !== null)).toBe(true);

    expect(await loadFormStart(web.db, visit)).toEqual({ status: "waiting" });
    expect(await submitDetails(web.db, visit, detailsSent())).toBe("already_sent");
    expect(await startLinkPhotoUpload(fileDeps, visit, "front", PHOTO)).toEqual({
      status: "not_found",
    });

    const log = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.entityId, visit.renterId), eq(activityLog.action, "submitted"))),
    );
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorType: "renter_link", actorId: visit.linkId });
    expect(JSON.stringify(log)).not.toContain("1234567");
  });

  it("shows the Operator it is waiting, and no other Operator", async () => {
    const visit = await openRenterLink();
    await addPhoto(visit, "front");
    await addPhoto(visit, "back");
    await submitDetails(web.db, visit, detailsSent());
    const renter = { operatorId: actor.operatorId, renterId: visit.renterId };
    expect(await loadWaitingSubmission(web.db, renter)).not.toBeNull();
    expect(
      await loadWaitingSubmission(web.db, { ...renter, operatorId: otherActor.operatorId }),
    ).toBeNull();
  });

  it("allows 50 address searches per link", async () => {
    const visit = await openRenterLink();
    for (let i = 0; i < MAXIMUM_LINK_ADDRESS_SEARCHES; i += 1) {
      expect(await countAddressSearch(web.db, visit)).toBe(true);
    }
    expect(await countAddressSearch(web.db, visit)).toBe(false);
  });

  it("does nothing for a link pretending to be another Operator's", async () => {
    const visit = await openRenterLink();
    const forged = { ...visit, operatorId: otherActor.operatorId };
    expect(await countAddressSearch(web.db, forged)).toBe(false);
    await expect(loadFormStart(web.db, forged)).rejects.toThrow();
    await expect(startLinkPhotoUpload(fileDeps, forged, "front", PHOTO)).rejects.toThrow();
  });
});
