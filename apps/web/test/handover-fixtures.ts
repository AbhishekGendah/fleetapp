import { drawnSignatureInput } from "@fleetapp/core";
import { SAMPLE_JPEG } from "@fleetapp/core/testing";
import type { TestConnection } from "@fleetapp/db/testing";
import type { EmailMessage } from "@fleetapp/email";
import { expect } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { recordBondReceived } from "../src/lib/bonds/bond-records";
import { issueDocument } from "../src/lib/contracts/issued-documents";
import { confirmUpload, type FileDependencies } from "../src/lib/files/stored-files";
import { completeHandover } from "../src/lib/handover/complete-handover";
import {
  startChecklistPhotoUpload,
  type ChecklistPhotoTarget,
} from "../src/lib/handover/handover-photos";
import { loadHandover, loadReturn } from "../src/lib/handover/handover-queries";
import { saveHandoverDetails, startHandover } from "../src/lib/handover/handover-records";
import type { MemoryFileStorage } from "../src/lib/storage/memory-file-storage";
import { addRenterReadyToRent, bookTestRental, TEST_TIME_ZONE } from "./rental-fixtures";
import { recordingEmailSender } from "./renter-link-fixtures";

/** A real one-pixel PNG: a signature must be a picture of a sensible size (review G5-1). */
export const TEST_SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PHOTO_SIZES = { contentType: "image/jpeg", sizeBytes: 300_000 };
export const TEST_DETAILS = {
  fuelLevel: "full" as const,
  keysCount: 2,
  accessories: null,
  notes: null,
};
/** The test car's kilometres at its handover; it starts at 12,000. */
export const HANDOVER_KM = 12_500;

/** What the checklist tests share: one Operator, stand-in storage, a recording inbox. */
export function checklistKit(
  web: TestConnection,
  storage: MemoryFileStorage,
  sentEmails: EmailMessage[],
  actor: ActingUser,
) {
  const deps = (): FileDependencies & { storage: MemoryFileStorage } => ({
    database: web.db,
    storage,
    now: () => new Date(),
  });
  const handoverDeps = () => ({ ...deps(), emailSender: recordingEmailSender(sentEmails) });

  /** A booked rental for a Renter with everything on file, its contract signed and bond held. */
  async function readyRental(options: { isBondHeld?: boolean } = {}) {
    const renterId = await addRenterReadyToRent(web, deps(), actor);
    const booked = await bookTestRental(web, actor, renterId);
    await issueDocument(deps(), actor, {
      rentalId: booked.rentalId,
      kind: "contract",
      templateVersionId: null,
      pdf: new TextEncoder().encode("%PDF-1.4 signed"),
    });
    if (options.isBondHeld !== false) {
      await recordBondReceived(web.db, actor, booked.rentalId, {
        amountCents: 500_00,
        method: "cash",
        reference: null,
        occurredOn: "2026-10-30",
      });
    }
    return booked;
  }

  async function takePhoto(inspectionId: string, target: ChecklistPhotoTarget): Promise<string> {
    const start = await startChecklistPhotoUpload(
      deps(),
      actor,
      inspectionId,
      target,
      { photo: PHOTO_SIZES, thumbnail: { ...PHOTO_SIZES, sizeBytes: 30_000 } },
      TEST_TIME_ZONE,
    );
    if (start.status !== "allowed") {
      throw new Error(`The photo was not allowed: ${start.status}`);
    }
    const [photoPermission, thumbnailPermission] = storage.permissions.slice(-2);
    storage.receive(photoPermission!.area, photoPermission!.key, SAMPLE_JPEG);
    storage.receive(thumbnailPermission!.area, thumbnailPermission!.key, SAMPLE_JPEG);
    expect(
      await confirmUpload(deps(), actor, start.thumbnail.fileId, ["vehicle_photo_thumbnail"]),
    ).toBe("confirmed");
    expect(await confirmUpload(deps(), actor, start.photo.fileId, ["vehicle_photo"])).toBe(
      "confirmed",
    );
    return start.photo.fileId;
  }

  /** Every photo on the checklist's list taken, and the details saved. */
  async function fillChecklist(inspectionId: string, odometerKm: number): Promise<void> {
    const view =
      (await loadHandover(web.db, actor.operatorId, inspectionId)) ??
      (await loadReturn(web.db, actor.operatorId, inspectionId));
    for (const photoName of view?.photoNames ?? []) {
      await takePhoto(inspectionId, { photoName });
    }
    await saveHandoverDetails(web.db, actor, inspectionId, { ...TEST_DETAILS, odometerKm });
  }

  /** A checklist with every photo taken and the details saved. */
  async function filledHandover(rentalId: string): Promise<string> {
    const started = await startHandover(web.db, actor, rentalId);
    const inspectionId = "inspectionId" in started ? started.inspectionId : "";
    await fillChecklist(inspectionId, HANDOVER_KM);
    return inspectionId;
  }

  /** A rental whose car went out at `handedOverAt`, the Renter accepting on the phone. */
  async function rentalOut(handedOverAt: Date) {
    const booked = await readyRental();
    const inspectionId = await filledHandover(booked.rentalId);
    const result = await completeHandover(
      handoverDeps(),
      actor,
      inspectionId,
      {
        signature: drawnSignatureInput(TEST_SIGNATURE),
        bondOverrideReason: null,
        directDebitOverrideReason: null,
      },
      { timeZone: TEST_TIME_ZONE, now: handedOverAt },
    );
    expect(result.status).toBe("completed");
    return booked;
  }

  return { deps, handoverDeps, readyRental, takePhoto, fillChecklist, filledHandover, rentalOut };
}
