import { parseListQuery } from "@fleetapp/core";
import { activityLog, files, renterSubmissions } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { RENTER_LIST } from "../src/app/renters/renter-list";
import type { ActingUser } from "../src/lib/acting-user";
import type { LinkVisit } from "../src/lib/renter-links/link-visits";
import {
  approveSubmission,
  loadSubmissionForReview,
  openSubmittedPhoto,
  sendBackSubmission,
} from "../src/lib/renter-links/reviews";
import { removeOldSubmissions } from "../src/lib/renter-links/submission-cleanup";
import { loadFormStart, submitDetails } from "../src/lib/renter-links/submissions";
import { cancelDetailsLink } from "../src/lib/renter-links/details-links";
import { parseLicenceForm } from "../src/lib/renters/licence-input";
import { buildEverythingHeld } from "../src/lib/renters/everything-held";
import { saveLicence } from "../src/lib/renters/licence-records";
import { listLicenceScans } from "../src/lib/renters/licence-scans";
import { loadRenter, listRenterPage } from "../src/lib/renters/renter-queries";
import { seedOperatorWithUser } from "./car-fixtures";
import {
  detailsSent,
  linkTestKit,
  openRenterLink,
  sendEverything,
  type LinkTestKit,
} from "./renter-link-fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("the Operator's review of what a Renter sent", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherActor: ActingUser;
  let kit: LinkTestKit;

  function waitingId(visit: LinkVisit): Promise<string> {
    return loadSubmissionForReview(web.db, actor.operatorId, visit.renterId).then(
      (submission) => submission!.id,
    );
  }

  function renterLog(renterId: string) {
    return withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({
          action: activityLog.action,
          actorType: activityLog.actorType,
          after: activityLog.valuesAfter,
        })
        .from(activityLog)
        .where(and(eq(activityLog.entityType, "renter"), eq(activityLog.entityId, renterId)))
        .orderBy(asc(activityLog.occurredAt)),
    );
  }

  function sendBack(visit: LinkVisit, submissionId: string, note = "The back photo is blurry") {
    return sendBackSubmission(kit.linkDeps, actor, visit.renterId, { submissionId, note });
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Reviews Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Reviews Pty Ltd");
    kit = linkTestKit(web, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("shows what was sent, flags the Renter on the list, and logs every photo opened", async () => {
    const visit = await openRenterLink(kit);
    await sendEverything(kit, visit);
    const submission = await loadSubmissionForReview(web.db, actor.operatorId, visit.renterId);
    expect(submission).toMatchObject({
      details: { fullName: "Sam Example", dateOfBirth: "1990-04-02" },
      licence: { licenceNumber: "1234567" },
    });
    expect(submission!.photos.front).not.toBeNull();

    const waiting = await listRenterPage(
      web.db,
      actor.operatorId,
      parseListQuery(RENTER_LIST, { status: "waiting_review" }),
    );
    expect(waiting.rows).toContainEqual(
      expect.objectContaining({ id: visit.renterId, isWaitingReview: true }),
    );

    const workbook = await buildEverythingHeld(web.db, actor, visit.renterId, "Australia/Perth");
    const sentSheet = workbook!.sheets.find((sheet) => sheet.name === "Sent through link")!;
    expect(sentSheet.table).toHaveLength(2);
    expect(JSON.stringify(sentSheet.table)).toContain("Waiting for review");
    expect(JSON.stringify(sentSheet.table)).toContain("1234567");

    const photoId = submission!.photos.front!.id;
    expect(await openSubmittedPhoto(kit.fileDeps, actor, visit.renterId, photoId)).not.toBeNull();
    expect(await openSubmittedPhoto(kit.fileDeps, otherActor, visit.renterId, photoId)).toBeNull();
    expect(await loadSubmissionForReview(web.db, otherActor.operatorId, visit.renterId)).toBeNull();
    const [opened] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ action: activityLog.action, actorId: activityLog.actorId })
        .from(activityLog)
        .where(and(eq(activityLog.entityId, photoId), eq(activityLog.action, "viewed"))),
    );
    expect(opened).toEqual({ action: "viewed", actorId: actor.userId });
  });

  it("approves: copies the details and licence in, and the photos become the scans", async () => {
    const visit = await openRenterLink(kit);
    await sendEverything(kit, visit, { licenceNumber: "2223334" });
    const submissionId = await waitingId(visit);
    expect(await approveSubmission(kit.fileDeps, otherActor, visit.renterId, submissionId)).toBe(
      "not_found",
    );
    expect(await approveSubmission(kit.fileDeps, actor, visit.renterId, submissionId)).toBe(
      "approved",
    );

    expect(await loadRenter(web.db, actor.operatorId, visit.renterId)).toMatchObject({
      dateOfBirth: "1990-04-02",
      residentialAddress: "1 Example St, Perth WA 6000",
      licenceNumber: "2223334",
    });
    const scans = await listLicenceScans(web.db, actor.operatorId, visit.renterId);
    expect(scans.front).not.toBeNull();
    expect(scans.back).not.toBeNull();
    expect(await loadSubmissionForReview(web.db, actor.operatorId, visit.renterId)).toBeNull();
    // A second approval of the same submission finds nothing waiting.
    expect(await approveSubmission(kit.fileDeps, actor, visit.renterId, submissionId)).toBe(
      "not_found",
    );

    const log = await renterLog(visit.renterId);
    expect(log.map((line) => line.action)).toEqual([
      "created",
      "submitted",
      "updated",
      "updated",
      "approved",
    ]);
    expect(JSON.stringify(log)).not.toContain("2223334");
  });

  it("refuses, changing nothing, when another Renter already has the licence", async () => {
    const holder = await openRenterLink(kit, "Licence Holder");
    const licence = parseLicenceForm({
      licenceIssuedIn: "WA",
      licenceCountry: "",
      licenceNumber: "5556667",
      licenceClass: "C",
      licenceType: "full",
      licenceExpiresOn: "2029-01-01",
    });
    await saveLicence(web.db, actor, holder.renterId, licence.data!);
    const visit = await openRenterLink(kit);
    await sendEverything(kit, visit, { licenceNumber: "5556667" });
    const submissionId = await waitingId(visit);

    expect(await approveSubmission(kit.fileDeps, actor, visit.renterId, submissionId)).toEqual({
      status: "on_file",
      renterId: holder.renterId,
      isArchived: false,
    });
    expect(await loadRenter(web.db, actor.operatorId, visit.renterId)).toMatchObject({
      dateOfBirth: null,
      licenceNumber: null,
    });
    expect(await waitingId(visit)).toBe(submissionId);
  });

  it("sends back with a note: emailed, shown on the link with what was sent, and resent", async () => {
    const visit = await openRenterLink(kit);
    await sendEverything(kit, visit, { residentialAddress: "9 Typo St, Perth WA 6000" });
    const submissionId = await waitingId(visit);

    expect(await sendBack(visit, submissionId)).toEqual({ status: "sent_back", isEmailed: true });
    expect(kit.sentEmails.at(-1)).toMatchObject({ to: "sam@example.test" });
    expect(kit.sentEmails.at(-1)!.text).toContain("The back photo is blurry");

    const start = await loadFormStart(web.db, visit);
    expect(start).toMatchObject({
      status: "open",
      sentBackNote: "The back photo is blurry",
      values: { residentialAddress: "9 Typo St, Perth WA 6000" },
      // Their photos came back with it, so only a retake is needed.
      photos: { front: true, back: true },
    });
    expect(await submitDetails(web.db, visit, detailsSent())).toBe("sent");
    expect(await loadFormStart(web.db, visit)).toEqual({ status: "waiting" });

    const log = await renterLog(visit.renterId);
    expect(log.map((line) => line.action)).toContain("sent_back");
    expect(JSON.stringify(log)).not.toContain("blurry");
  });

  it("cannot send back once the Renter has no working link", async () => {
    const visit = await openRenterLink(kit);
    await sendEverything(kit, visit);
    await cancelDetailsLink(web.db, actor, visit.renterId, new Date());
    expect(await sendBack(visit, await waitingId(visit))).toEqual({ status: "link_ended" });
  });

  it("removes what was sent 30 days after the link ended, keeping scans made from it", async () => {
    const abandoned = await openRenterLink(kit);
    await sendEverything(kit, abandoned);
    const approved = await openRenterLink(kit, "Approved Renter");
    await sendEverything(kit, approved, { licenceNumber: "8889990" });
    await approveSubmission(kit.fileDeps, actor, approved.renterId, await waitingId(approved));

    const tooSoon = await removeOldSubmissions({
      ...kit.fileDeps,
      now: () => new Date(Date.now() + 20 * DAY_MS),
    });
    expect(tooSoon.removedSubmissions).toBe(0);

    // Links last 7 days: 40 days on, each ended more than 30 days ago.
    const later = { ...kit.fileDeps, now: () => new Date(Date.now() + 40 * DAY_MS) };
    const summary = await removeOldSubmissions(later);
    expect(summary.failedOperators).toBe(0);
    expect(summary.removedSubmissions).toBeGreaterThanOrEqual(2);

    // Approved ones go too: by then everything is on the Renter's record.
    const left = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ renterId: renterSubmissions.renterId })
        .from(renterSubmissions)
        .where(inArray(renterSubmissions.renterId, [abandoned.renterId, approved.renterId])),
    );
    expect(left).toEqual([]);
    const abandonedPhotos = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ deletedAt: files.deletedAt })
        .from(files)
        .where(eq(files.renterLinkId, abandoned.linkId)),
    );
    expect(abandonedPhotos.every((photo) => photo.deletedAt !== null)).toBe(true);
    expect(
      (await listLicenceScans(web.db, actor.operatorId, approved.renterId)).front,
    ).not.toBeNull();
    expect((await renterLog(abandoned.renterId)).at(-1)).toMatchObject({
      action: "submission_removed",
      actorType: "system",
    });
    // Safe to run again.
    expect((await removeOldSubmissions(later)).removedSubmissions).toBe(0);
  });
});
