import { addNote } from "../src/lib/renters/notes";
import { rentals } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { buildEverythingHeld } from "../src/lib/renters/everything-held";
import { everythingHeldZip } from "../src/lib/renters/everything-held-zip";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { checklistKit } from "./handover-fixtures";

const PERTH = "Australia/Perth";
/** The staff member the test business's User is: never named in the download. */
const STAFF_NAME = "Jo Citizen";
const HANDED_OVER = new Date("2026-10-20T01:00:00Z");

async function zipEntries(stream: ReadableStream<Uint8Array>): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** "Download everything we hold" really is everything (review A7-8, A3-5). */
describe("everything held about a Renter", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let actor: ActingUser;
  let otherBusiness: ActingUser;
  let kit: ReturnType<typeof checklistKit>;

  async function renterOf(rentalId: string): Promise<string> {
    const [rental] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select({ renterId: rentals.renterId }).from(rentals).where(eq(rentals.id, rentalId)),
    );
    return rental!.renterId;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    const sentEmails: EmailMessage[] = [];
    actor = await seedOperatorWithUser(admin, "Held Rentals Pty Ltd");
    otherBusiness = await seedOperatorWithUser(admin, "Other Held Pty Ltd");
    kit = checklistKit(web, storage, sentEmails, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("holds every section, the documents themselves, and no staff names", async () => {
    const { rentalId } = await kit.rentalOut(HANDED_OVER);
    const renterId = await renterOf(rentalId);
    await addNote(web.db, actor, renterId, "Prefers a text message.");
    // Another Renter of the same business: none of theirs comes along.
    const { rentalId: otherRentalId } = await kit.readyRental();

    const held = await buildEverythingHeld(web.db, actor, renterId, PERTH);

    expect(held?.sheets.map((sheet) => sheet.name)).toEqual([
      "Details",
      "Licence",
      "Notes",
      "Licence scans",
      "Sent through link",
      "Rentals",
      "Changes of terms",
      "Charges and payments",
      "Bond",
      "Invoices and receipts",
      "Direct debit and Stripe",
      "Signing records",
      "Links",
      "Damage",
      "Emails sent",
      "Documents",
      "Log",
    ]);
    const cells = JSON.stringify(held?.sheets);
    expect(cells).not.toContain(STAFF_NAME);
    expect(cells).toContain("The business");
    const rentalsSheet = held!.sheets.find((sheet) => sheet.name === "Rentals")!;
    expect(rentalsSheet.table).toHaveLength(2);
    expect(cells).not.toContain(otherRentalId);
    const kinds = held!.files.map((file) => file.path.split("/")[0]);
    expect(kinds).toEqual(expect.arrayContaining(["documents", "licence-scans"]));

    const entries = await zipEntries(everythingHeldZip(held!, new Uint8Array([1, 2]), storage));
    const names = Object.keys(entries);
    expect(names).toContain("everything-held.xlsx");
    expect(names.filter((name) => name.startsWith("documents/")).length).toBe(
      held!.files.filter((file) => file.path.startsWith("documents/")).length,
    );
    expect(names.some((name) => /^documents\/rental-contract-v1-.*\.pdf$/.test(name))).toBe(true);
    expect(names.some((name) => /^documents\/handover-report-v1-.*\.pdf$/.test(name))).toBe(true);
    expect(names.some((name) => name.startsWith("licence-scans/"))).toBe(true);
    expect(names).not.toContain("files-not-included.txt");
  });

  it("lists a file it could not read, rather than leaving it out silently", async () => {
    const { rentalId } = await kit.readyRental();
    const held = await buildEverythingHeld(web.db, actor, await renterOf(rentalId), PERTH);
    const missing = { path: "documents/gone.pdf", area: "general" as const, key: "not/there" };

    const entries = await zipEntries(
      everythingHeldZip({ ...held!, files: [missing] }, new Uint8Array([1]), storage),
    );

    expect(strFromU8(entries["files-not-included.txt"]!)).toContain("documents/gone.pdf");
  });

  it("gives another business nothing", async () => {
    const { rentalId } = await kit.readyRental();

    expect(
      await buildEverythingHeld(web.db, otherBusiness, await renterOf(rentalId), PERTH),
    ).toBeNull();
  });
});
