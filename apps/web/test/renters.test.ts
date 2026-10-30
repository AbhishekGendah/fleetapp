import { parseListQuery, WITHHELD_VALUE } from "@fleetapp/core";
import { activityLog } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import {
  emptyRenterForm,
  parseRenterForm,
  renterFormValues,
  renterStatusInputSchema,
  type RenterFormValues,
  type RenterInput,
} from "../src/lib/renters/renter-input";
import {
  exportRenters,
  findRentersSharingContact,
  listRenterPage,
  loadRenter,
} from "../src/lib/renters/renter-queries";
import {
  archiveRenter,
  changeRenterStatus,
  createRenter,
  restoreRenter,
  updateRenter,
} from "../src/lib/renters/renter-records";
import { RENTER_LIST } from "../src/app/renters/renter-list";
import { seedOperatorWithUser } from "./car-fixtures";

const TODAY = "2026-10-30";

function renterInput(changes: Partial<RenterFormValues> = {}): RenterInput {
  const parsed = parseRenterForm(
    { ...emptyRenterForm(), fullName: "Sam Example", phone: "0412345678", ...changes },
    TODAY,
  );
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data;
}

describe("the Renter form's rules", () => {
  it("needs only a name and a phone or email", () => {
    expect(parseRenterForm({ ...emptyRenterForm(), fullName: "Sam" }, TODAY).success).toBe(false);
    expect(
      parseRenterForm({ ...emptyRenterForm(), fullName: "Sam", email: "SAM@Example.TEST" }, TODAY)
        .data,
    ).toMatchObject({ email: "sam@example.test", phone: null, dateOfBirth: null });
  });

  it("tidies the phone and refuses a birth date under 16", () => {
    expect(renterInput().phone).toBe("0412 345 678");
    expect(
      parseRenterForm(
        { ...emptyRenterForm(), fullName: "Kid", phone: "0412345678", dateOfBirth: "2011-01-01" },
        TODAY,
      ).success,
    ).toBe(false);
  });

  it("keeps no postal address while it is the same as home", () => {
    expect(renterInput({ postalAddress: "PO Box 1" }).postalAddress).toBeNull();
    expect(renterInput({ isPostalSameAsHome: "", postalAddress: "PO Box 1" }).postalAddress).toBe(
      "PO Box 1",
    );
  });

  it("needs a reason for do not rent, and drops it when active again", () => {
    expect(
      renterStatusInputSchema.safeParse({ status: "do_not_rent", doNotRentReason: "" }).success,
    ).toBe(false);
    expect(
      renterStatusInputSchema.parse({ status: "active", doNotRentReason: "Left over" }),
    ).toEqual({ status: "active", doNotRentReason: null });
  });
});

describe("an Operator's Renters", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherActor: ActingUser;

  async function logOf(renterId: string) {
    return withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({
          action: activityLog.action,
          before: activityLog.valuesBefore,
          after: activityLog.valuesAfter,
        })
        .from(activityLog)
        .where(and(eq(activityLog.entityType, "renter"), eq(activityLog.entityId, renterId)))
        .orderBy(asc(activityLog.occurredAt)),
    );
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Renters Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Renters Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("adds and edits a Renter, logging which details changed but never what they are", async () => {
    const renterId = await createRenter(web.db, actor, renterInput());
    expect(await updateRenter(web.db, actor, renterId, renterInput({ phone: "0499999999" }))).toBe(
      "changed",
    );
    expect(await updateRenter(web.db, actor, renterId, renterInput({ phone: "0499999999" }))).toBe(
      "unchanged",
    );

    const log = await logOf(renterId);
    expect(log.map((line) => line.action)).toEqual(["created", "updated"]);
    expect(JSON.stringify(log)).not.toContain("Sam Example");
    expect(JSON.stringify(log)).not.toContain("0499 999 999");
    expect(log[1]).toMatchObject({
      before: { phone: WITHHELD_VALUE },
      after: { phone: WITHHELD_VALUE },
    });
    const saved = await loadRenter(web.db, actor.operatorId, renterId);
    expect(saved).toMatchObject({ phone: "0499 999 999" });
    expect(renterFormValues(saved!)).toMatchObject({
      phone: "0499 999 999",
      isPostalSameAsHome: "on",
    });
  });

  it("sets do not rent with a private reason, and archives and restores", async () => {
    const renterId = await createRenter(web.db, actor, renterInput({ fullName: "Pat Late" }));
    expect(
      await changeRenterStatus(web.db, actor, renterId, {
        status: "do_not_rent",
        doNotRentReason: "Three late returns",
      }),
    ).toBe("changed");
    const statusLine = (await logOf(renterId)).find((line) => line.action === "status_changed");
    expect(statusLine?.after).toEqual({ status: "do_not_rent", doNotRentReason: WITHHELD_VALUE });

    expect(await archiveRenter(web.db, actor, renterId)).toBe("changed");
    expect(await updateRenter(web.db, actor, renterId, renterInput())).toBe("not_found");
    expect(await restoreRenter(web.db, actor, renterId)).toBe("changed");
  });

  it("notes other Renters sharing a phone or email, archived ones too", async () => {
    const first = await createRenter(web.db, actor, renterInput({ phone: "0400111222" }));
    const second = await createRenter(
      web.db,
      actor,
      renterInput({ fullName: "Alex Example", phone: "0400111222", email: "alex@example.test" }),
    );
    await archiveRenter(web.db, actor, first);
    const renter = await loadRenter(web.db, actor.operatorId, second);
    expect(await findRentersSharingContact(web.db, actor.operatorId, renter!)).toEqual([
      {
        id: first,
        fullName: "Sam Example",
        isArchived: true,
        sharesPhone: true,
        sharesEmail: false,
      },
    ]);
  });

  it("searches the list, and logs every export", async () => {
    await createRenter(web.db, actor, renterInput({ fullName: "Findable Person" }));
    const query = parseListQuery(RENTER_LIST, { q: "findable" });
    const page = await listRenterPage(web.db, actor.operatorId, query);
    expect(page.rows.map((row) => row.fullName)).toEqual(["Findable Person"]);

    const exported = await exportRenters(web.db, actor, query, "csv");
    expect(exported).toHaveLength(1);
    const [exportLine] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ action: activityLog.action, after: activityLog.valuesAfter })
        .from(activityLog)
        .where(and(eq(activityLog.entityType, "operator"), eq(activityLog.action, "exported"))),
    );
    expect(exportLine?.after).toEqual({ list: "renters", format: "csv", rows: 1 });
  });

  it("keeps one Operator's Renters from another", async () => {
    const renterId = await createRenter(web.db, actor, renterInput());
    expect(await loadRenter(web.db, otherActor.operatorId, renterId)).toBeNull();
    expect(await updateRenter(web.db, otherActor, renterId, renterInput())).toBe("not_found");
    expect(
      await changeRenterStatus(web.db, otherActor, renterId, {
        status: "do_not_rent",
        doNotRentReason: "Not theirs",
      }),
    ).toBe("not_found");
    expect(await archiveRenter(web.db, otherActor, renterId)).toBe("unchanged");
    const page = await listRenterPage(
      web.db,
      otherActor.operatorId,
      parseListQuery(RENTER_LIST, {}),
    );
    expect(page.rows).toEqual([]);
  });
});
