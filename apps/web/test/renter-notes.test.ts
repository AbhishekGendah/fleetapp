import { activityLog } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { buildEverythingHeld } from "../src/lib/renters/everything-held";
import { parseLicenceForm } from "../src/lib/renters/licence-input";
import { saveLicence } from "../src/lib/renters/licence-records";
import { noteInputSchema } from "../src/lib/renters/note-input";
import { addNote, listNotes, removeNote } from "../src/lib/renters/notes";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { archiveRenter, createRenter, updateRenter } from "../src/lib/renters/renter-records";
import { seedOperatorWithUser } from "./car-fixtures";

const PERTH = "Australia/Perth";

describe("a note's rules", () => {
  it("keeps line breaks, and needs something written", () => {
    expect(noteInputSchema.parse({ body: "  Late return.\nPaid the fee.  " })).toEqual({
      body: "Late return.\nPaid the fee.",
    });
    expect(noteInputSchema.safeParse({ body: "   " }).success).toBe(false);
  });
});

describe("a Renter's notes and everything held about them", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherActor: ActingUser;

  async function addRenter(): Promise<string> {
    const parsed = parseRenterForm(
      {
        ...emptyRenterForm(),
        fullName: "Sam Example",
        phone: "0412345678",
        dateOfBirth: "1998-05-04",
      },
      "2026-10-31",
    );
    return createRenter(web.db, actor, parsed.data!);
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Notes Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Notes Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("adds and removes notes, logging that they were but never what they say", async () => {
    const renterId = await addRenter();
    expect(await addNote(web.db, actor, renterId, "Returned the car two days late.")).toBe("added");
    expect(await addNote(web.db, actor, renterId, "Paid the late fee.")).toBe("added");
    const notes = await listNotes(web.db, actor.operatorId, renterId);
    expect(notes.map((note) => note.body)).toEqual([
      "Paid the late fee.",
      "Returned the car two days late.",
    ]);
    expect(notes[0]?.writtenBy).toBe("Jo Citizen");

    expect(await removeNote(web.db, actor, renterId, notes[0]!.id)).toBe("removed");
    expect(await removeNote(web.db, actor, renterId, notes[0]!.id)).toBe("not_found");
    expect(await listNotes(web.db, actor.operatorId, renterId)).toHaveLength(1);
    expect(
      await listNotes(web.db, actor.operatorId, renterId, { isRemovedIncluded: true }),
    ).toHaveLength(2);

    const log = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(activityLog).where(eq(activityLog.entityType, "renter_note")),
    );
    expect(log.map((line) => line.action).sort()).toEqual(["archived", "created", "created"]);
    expect(JSON.stringify(log)).not.toContain("late");
  });

  it("puts everything held into one workbook, licence number included, and logs the download", async () => {
    const renterId = await addRenter();
    await saveLicence(
      web.db,
      actor,
      renterId,
      parseLicenceForm({
        licenceIssuedIn: "WA",
        licenceCountry: "",
        licenceNumber: "1234567",
        licenceClass: "C",
        licenceType: "full",
        licenceExpiresOn: "2028-05-04",
      }).data!,
    );
    await addNote(web.db, actor, renterId, '=HYPERLINK("bad")');
    await updateRenter(
      web.db,
      actor,
      renterId,
      parseRenterForm(
        { ...emptyRenterForm(), fullName: "Sam Example", phone: "0499999999" },
        "2026-10-31",
      ).data!,
    );

    const workbook = await buildEverythingHeld(web.db, actor, renterId, PERTH);
    expect(workbook?.sheets.map((sheet) => sheet.name)).toEqual([
      "Details",
      "Licence",
      "Notes",
      "Licence scans",
      "Sent through link",
      "Log",
    ]);
    const cells = JSON.stringify(workbook?.sheets);
    expect(cells).toContain("1234567");
    expect(cells).toContain("0499 999 999");
    // A note that looks like a formula cannot run when the file is opened.
    expect(cells).toContain(`'=HYPERLINK`);
    const logSheet = workbook!.sheets.find((sheet) => sheet.name === "Log")!;
    expect(logSheet.table.some((row) => row.includes("Note added"))).toBe(true);
    expect(logSheet.table.some((row) => row[3] === "Phone, Date of birth")).toBe(true);

    const [download] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ action: activityLog.action })
        .from(activityLog)
        .where(and(eq(activityLog.entityId, renterId), eq(activityLog.action, "exported_all"))),
    );
    expect(download).toBeDefined();
  });

  it("keeps one Operator's notes and downloads from another, and archived Renters read-only", async () => {
    const renterId = await addRenter();
    await addNote(web.db, actor, renterId, "Fine.");
    const [note] = await listNotes(web.db, actor.operatorId, renterId);
    expect(await addNote(web.db, otherActor, renterId, "Not theirs.")).toBe("not_found");
    expect(await removeNote(web.db, otherActor, renterId, note!.id)).toBe("not_found");
    expect(await listNotes(web.db, otherActor.operatorId, renterId)).toEqual([]);
    expect(await buildEverythingHeld(web.db, otherActor, renterId, PERTH)).toBeNull();

    await archiveRenter(web.db, actor, renterId);
    expect(await addNote(web.db, actor, renterId, "Too late.")).toBe("not_found");
    expect(await buildEverythingHeld(web.db, actor, renterId, PERTH)).not.toBeNull();
  });
});
