import type { LicenceSide } from "@fleetapp/core";
import type { TestConnection } from "@fleetapp/db/testing";
import type { EmailMessage, EmailSender } from "@fleetapp/email";
import { expect } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { confirmUpload, type FileDependencies } from "../src/lib/files/stored-files";
import {
  detailsFormStart,
  parseDetailsForm,
  type DetailsFormValues,
  type DetailsInput,
} from "../src/lib/renter-links/details-form-input";
import { sendDetailsLink, type LinkDependencies } from "../src/lib/renter-links/details-links";
import { openLink, type LinkVisit } from "../src/lib/renter-links/link-visits";
import { startLinkPhotoUpload, submitDetails } from "../src/lib/renter-links/submissions";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { createRenter } from "../src/lib/renters/renter-records";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";

export const LINK_TEST_TODAY = "2026-10-31";
const JPEG_START = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const LINK_PHOTO = { contentType: "image/jpeg", sizeBytes: 300_000 };

/** What the tests need to send a link and act through it. */
export interface LinkTestKit {
  web: TestConnection;
  storage: MemoryFileStorage;
  fileDeps: FileDependencies;
  linkDeps: LinkDependencies;
  actor: ActingUser;
  /** Every email sent, newest last. */
  sentEmails: EmailMessage[];
}

export function recordingEmailSender(sentEmails: EmailMessage[]): EmailSender {
  return {
    async send(message) {
      sentEmails.push(message);
    },
  };
}

/** A Renter started from a phone call, and the details link they were sent. */
export async function openRenterLink(kit: LinkTestKit, name = "Sam Example"): Promise<LinkVisit> {
  const parsed = parseRenterForm(
    { ...emptyRenterForm(), fullName: name, email: "sam@example.test" },
    LINK_TEST_TODAY,
  );
  const renterId = await createRenter(kit.web.db, kit.actor, parsed.data!);
  const result = await sendDetailsLink(kit.linkDeps, kit.actor, renterId, 7);
  if (result.status !== "sent") {
    throw new Error(result.status);
  }
  return (await openLink(kit.web.db, result.url.split("/r/")[1]!))!;
}

/** Sends one licence photo through the link, as the Renter's phone does. */
export async function addLinkPhoto(
  kit: LinkTestKit,
  visit: LinkVisit,
  side: LicenceSide,
): Promise<string> {
  const start = await startLinkPhotoUpload(kit.fileDeps, visit, side, LINK_PHOTO);
  if (start.status !== "allowed") {
    throw new Error(`The photo was not allowed: ${start.status}`);
  }
  const permission = kit.storage.permissions.at(-1)!;
  kit.storage.receive(permission.area, permission.key, JPEG_START);
  expect(permission.area).toBe("identity");
  const linkActor = { operatorId: visit.operatorId, linkId: visit.linkId };
  expect(await confirmUpload(kit.fileDeps, linkActor, start.fileId)).toBe("confirmed");
  return start.fileId;
}

/** A complete, valid form as a Renter would send it. */
export function detailsSent(changes: Partial<DetailsFormValues> = {}): DetailsInput {
  const parsed = parseDetailsForm(
    {
      ...detailsFormStart({ ...emptyRenterForm(), fullName: "Sam Example" }),
      email: "sam@example.test",
      dateOfBirth: "1990-04-02",
      residentialAddress: "1 Example St, Perth WA 6000",
      licenceIssuedIn: "WA",
      licenceNumber: "1234567",
      licenceExpiresOn: "2029-01-01",
      ...changes,
    },
    LINK_TEST_TODAY,
  );
  if (!parsed.success) {
    throw new Error(JSON.stringify(parsed.errors));
  }
  return parsed.data;
}

/** Both photos and the form, sent: the submission now waits for review. */
export async function sendEverything(
  kit: LinkTestKit,
  visit: LinkVisit,
  changes: Partial<DetailsFormValues> = {},
): Promise<void> {
  await addLinkPhoto(kit, visit, "front");
  await addLinkPhoto(kit, visit, "back");
  expect(await submitDetails(kit.web.db, visit, detailsSent(changes))).toBe("sent");
}

/** A kit for one Operator, with an in-memory file store and a recording email sender. */
export function linkTestKit(web: TestConnection, actor: ActingUser): LinkTestKit {
  const storage = createMemoryFileStorage();
  const sentEmails: EmailMessage[] = [];
  return {
    web,
    storage,
    actor,
    sentEmails,
    fileDeps: { database: web.db, storage, now: () => new Date() },
    linkDeps: {
      database: web.db,
      emailSender: recordingEmailSender(sentEmails),
      now: () => new Date(),
      appUrl: "https://app.example.test",
      describeDay: (moment) => moment.toISOString().slice(0, 10),
    },
  };
}
