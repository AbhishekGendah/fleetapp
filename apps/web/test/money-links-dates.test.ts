import { parseListQuery } from "@fleetapp/core";
import { activityLog, renterLinks, renters } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailSender } from "@fleetapp/email";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { RENTER_LIST } from "../src/app/renters/renter-list";
import { saveNumbering } from "../src/lib/billing/numbering";
import { numberingInputSchema } from "../src/lib/billing/numbering-input";
import {
  addChargeType,
  archiveChargeType,
  listChargeTypes,
  restoreChargeType,
} from "../src/lib/ledger/charge-types";
import { findPaymentsRental } from "../src/lib/payments/renter-checkout";
import { RENTAL_RETENTION_HOLDS } from "../src/lib/rentals/retention-holds";
import { checkLinkCode, sendLinkCode } from "../src/lib/renter-links/link-visits";
import { listRenterPage } from "../src/lib/renters/renter-queries";
import { isRentalRenterArchived } from "../src/lib/renters/renter-archived";
import { createRenter } from "../src/lib/renters/renter-records";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { loadOperatorSettings, saveOperatorSettings } from "../src/lib/settings/operator-settings";
import { seedOperatorWithUser } from "./car-fixtures";
import { linkTestKit, openRenterLink, type LinkTestKit } from "./renter-link-fixtures";
import { addTestRenter, bookTestRental } from "./rental-fixtures";

const NO_REQUEST_META = { ipAddress: null, userAgent: null };

/** Batch 7, slice D: money, settings, Renter links and dates. */
describe("money, settings and Renter links", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let other: ActingUser;
  let kit: LinkTestKit;

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Money Links Pty Ltd");
    other = await seedOperatorWithUser(admin, "Other Money Links Pty Ltd");
    kit = linkTestKit(web, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("keeps both of two first settings saves made at the same moment (review A8-3)", async () => {
    const fresh = await seedOperatorWithUser(admin, "Fresh Settings Pty Ltd");

    await Promise.all([
      saveOperatorSettings(web.db, fresh, { graceMinutes: 45 }),
      saveOperatorSettings(web.db, fresh, { ongoingNoticeDays: 14 }),
    ]);
    const saved = await loadOperatorSettings(web.db, fresh.operatorId);

    expect(saved.graceMinutes).toBe(45);
    expect(saved.ongoingNoticeDays).toBe(14);
  });

  it("takes only digits and commas for the next invoice number (review A4-12)", () => {
    const parse = (nextNumber: string) =>
      numberingInputSchema.safeParse({ prefix: "INV-", nextNumber }).success;

    expect(parse("1e3")).toBe(false);
    expect(parse("0x10")).toBe(false);
    expect(parse("1.5")).toBe(false);
    expect(parse("1,001")).toBe(true);
    expect(parse("1001")).toBe(true);
  });

  it("logs the numbering's first set-up, by the system (review A4-12)", async () => {
    const fresh = await seedOperatorWithUser(admin, "Fresh Numbers Pty Ltd");

    await saveNumbering(web.db, fresh, "invoice", { prefix: "INV-", nextNumber: 1001 });
    await saveNumbering(web.db, fresh, "invoice", { prefix: "INV-", nextNumber: 2001 });
    const lines = await withTenant(web.db, fresh.operatorId, (tx) =>
      tx
        .select({ actorType: activityLog.actorType, action: activityLog.action })
        .from(activityLog)
        .where(
          and(eq(activityLog.entityType, "document_numbering"), eq(activityLog.action, "created")),
        ),
    );

    expect(lines).toEqual([{ actorType: "system", action: "created" }]);
  });

  it("brings back a charge type archived by mistake (review G4-4)", async () => {
    const typeId = await addChargeType(web.db, actor, {
      name: "Car wash",
      gstTreatment: "taxable",
    });
    await archiveChargeType(web.db, actor, typeId);

    expect(await restoreChargeType(web.db, actor, typeId)).toBe("restored");
    expect(await restoreChargeType(web.db, actor, typeId)).toBe("not_found");
    const types = await listChargeTypes(web.db, actor.operatorId);
    expect(types.find((type) => type.id === typeId)?.isArchived).toBe(false);
  });

  it("finds only this business's rentals when deciding to keep a licence scan (review G8-9)", async () => {
    const renterId = await addTestRenter(web, actor, "Scan Keeper");
    await bookTestRental(web, actor, renterId);

    const own = await withTenant(web.db, actor.operatorId, (tx) =>
      RENTAL_RETENTION_HOLDS.rentersWithOpenMatters(tx, actor.operatorId, [renterId]),
    );
    const asOther = await withTenant(web.db, actor.operatorId, (tx) =>
      RENTAL_RETENTION_HOLDS.rentersWithOpenMatters(tx, other.operatorId, [renterId]),
    );

    expect(own.has(renterId)).toBe(true);
    expect(asOther.has(renterId)).toBe(false);
  });

  it("gives back the code a failed email used, and the earlier code still works (review G7-2)", async () => {
    const visit = await openRenterLink(kit);
    expect(await sendLinkCode(kit.linkDeps, visit)).toBe("sent");
    const earlierCode = /\b(\d{6})\b/.exec(kit.sentEmails.at(-1)!.text)![1]!;
    const [before] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(renterLinks).where(eq(renterLinks.id, visit.linkId)),
    );
    const failing: EmailSender = {
      async send() {
        throw new Error("Email is down");
      },
    };

    const result = await sendLinkCode({ ...kit.linkDeps, emailSender: failing }, visit);
    const [after] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(renterLinks).where(eq(renterLinks.id, visit.linkId)),
    );
    const sentLines = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(and(eq(activityLog.entityId, visit.linkId), eq(activityLog.action, "code_sent"))),
    );

    expect(result).toBe("not_sent");
    expect(after?.codesInWindow).toBe(before?.codesInWindow);
    expect(sentLines).toHaveLength(1);
    expect((await checkLinkCode(kit.linkDeps, visit, earlierCode, NO_REQUEST_META)).status).toBe(
      "right",
    );
  });

  it("still says sent when the code went but its history line could not be written (review)", async () => {
    const visit = await openRenterLink(kit, "Log Failure");
    let transactions = 0;
    const database = new Proxy(kit.linkDeps.database, {
      get(target, property, receiver) {
        if (property !== "transaction") {
          return Reflect.get(target, property, receiver);
        }
        transactions += 1;
        if (transactions === 2) {
          return () => Promise.reject(new Error("Database blip"));
        }
        return target.transaction.bind(target);
      },
    });

    const result = await sendLinkCode({ ...kit.linkDeps, database }, visit);

    expect(result).toBe("sent");
    expect(kit.sentEmails.at(-1)!.text).toMatch(/\b\d{6}\b/);
  });

  it("says what the link is for in the code email (review G7-3)", async () => {
    const visit = await openRenterLink(kit, "Purpose Example");

    await sendLinkCode(kit.linkDeps, visit);

    expect(kit.sentEmails.at(-1)!.text).toContain("Type this code to fill in your details");
  });

  it("finds no payments rental for an archived Renter, and knows why (review A3-13)", async () => {
    const renterId = await addTestRenter(web, actor, "Archived Payer");
    const { rentalId } = await bookTestRental(web, actor, renterId);
    // Archived as older data may be: the app now refuses while a booking is on.
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx.update(renters).set({ archivedAt: new Date() }).where(eq(renters.id, renterId)),
    );

    const found = await withTenant(web.db, actor.operatorId, (tx) =>
      findPaymentsRental(tx, { operatorId: actor.operatorId, rentalId, renterId: null }),
    );
    const isArchived = await withTenant(web.db, actor.operatorId, (tx) =>
      isRentalRenterArchived(tx, actor.operatorId, rentalId),
    );

    expect(found).toBeNull();
    expect(isArchived).toBe(true);
  });

  it("finds a Renter by a phone typed without spaces or as +61 (review A8-9)", async () => {
    const parsed = parseRenterForm(
      { ...emptyRenterForm(), fullName: "Phone Findable", phone: "0491 570 006" },
      "2026-11-05",
    );
    const renterId = await createRenter(web.db, actor, parsed.data!);
    const find = async (q: string) =>
      (await listRenterPage(web.db, actor.operatorId, parseListQuery(RENTER_LIST, { q }))).rows.map(
        (row) => row.id,
      );

    expect(await find("0491570006")).toContain(renterId);
    expect(await find("+61491570006")).toContain(renterId);
    expect(await find("0491 570")).toContain(renterId);
  });
});
