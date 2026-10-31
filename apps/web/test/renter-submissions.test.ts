import { MAXIMUM_LINK_ADDRESS_SEARCHES, type LicenceSide } from "@fleetapp/core";
import { activityLog, files, renters } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import type { FileDependencies } from "../src/lib/files/stored-files";
import { detailsFormStart, parseDetailsForm } from "../src/lib/renter-links/details-form-input";
import type { LinkVisit } from "../src/lib/renter-links/link-visits";
import {
  countAddressSearch,
  loadFormStart,
  loadWaitingSubmission,
  startLinkPhotoUpload,
  submitDetails,
} from "../src/lib/renter-links/submissions";
import { emptyRenterForm } from "../src/lib/renters/renter-input";
import { seedOperatorWithUser } from "./car-fixtures";
import {
  addLinkPhoto,
  detailsSent,
  LINK_PHOTO,
  LINK_TEST_TODAY,
  linkTestKit,
  openRenterLink as openKitLink,
  type LinkTestKit,
} from "./renter-link-fixtures";

describe("what a Renter sends through their details link", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let fileDeps: FileDependencies;
  let kit: LinkTestKit;
  let actor: ActingUser;
  let otherActor: ActingUser;

  const openRenterLink = () => openKitLink(kit);
  const addPhoto = (visit: LinkVisit, side: LicenceSide) => addLinkPhoto(kit, visit, side);

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
    actor = await seedOperatorWithUser(admin, "Submissions Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Submissions Pty Ltd");
    kit = linkTestKit(web, actor);
    fileDeps = kit.fileDeps;
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("needs date of birth, home address and the whole licence to send", () => {
    const start = detailsFormStart({ ...emptyRenterForm(), fullName: "Sam Example" });
    const parsed = parseDetailsForm({ ...start, phone: "0412345678" }, LINK_TEST_TODAY);
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
    expect(await startLinkPhotoUpload(fileDeps, visit, "front", LINK_PHOTO)).toEqual({
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
    await expect(startLinkPhotoUpload(fileDeps, forged, "front", LINK_PHOTO)).rejects.toThrow();
  });
});
