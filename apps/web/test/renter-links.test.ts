import { activityLog } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage, EmailSender } from "@fleetapp/email";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import {
  cancelDetailsLink,
  loadDetailsLink,
  sendDetailsLink,
  type LinkDependencies,
} from "../src/lib/renter-links/details-links";
import {
  checkLinkCode,
  isPhoneRemembered,
  openLink,
  sendLinkCode,
} from "../src/lib/renter-links/link-visits";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { createRenter } from "../src/lib/renters/renter-records";
import { seedOperatorWithUser } from "./car-fixtures";

const APP_URL = "https://app.example.test";
const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_IN_SUBJECT = /(\d{6})/;

describe("a Renter's details link", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherActor: ActingUser;
  let sent: EmailMessage[];
  let deps: LinkDependencies;

  const emailSender: EmailSender = {
    async send(message) {
      sent.push(message);
    },
  };

  async function addRenter(email: string | null = "sam@example.test"): Promise<string> {
    const parsed = parseRenterForm(
      { ...emptyRenterForm(), fullName: "Sam Example", phone: "0412345678", email: email ?? "" },
      "2026-10-31",
    );
    return createRenter(web.db, actor, parsed.data!);
  }

  function tokenOf(url: string): string {
    return url.split("/r/")[1]!;
  }

  function lastCode(): string {
    return CODE_IN_SUBJECT.exec(sent.at(-1)!.subject)![1]!;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Links Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Links Pty Ltd");
    sent = [];
    deps = {
      database: web.db,
      emailSender,
      now: () => new Date(),
      appUrl: APP_URL,
      describeDay: (moment) => moment.toISOString().slice(0, 10),
    };
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("emails the link from the Operator, opens it, and keeps only its fingerprint", async () => {
    const renterId = await addRenter();
    const result = await sendDetailsLink(deps, actor, renterId, 7);
    if (result.status !== "sent") {
      throw new Error(result.status);
    }
    expect(result.url.startsWith(`${APP_URL}/r/`)).toBe(true);
    expect(sent.at(-1)).toMatchObject({ to: "sam@example.test", fromName: "Links Pty Ltd" });
    expect(sent.at(-1)!.text).toContain(result.url);

    const visit = await openLink(web.db, tokenOf(result.url));
    expect(visit).toMatchObject({ renterId, maskedEmail: "s•••@example.test", isLocked: false });
    expect(await loadDetailsLink(web.db, actor.operatorId, renterId, new Date())).toMatchObject({
      sentToEmail: "sam@example.test",
      isExpired: false,
    });

    const log = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(activityLog).where(eq(activityLog.entityType, "renter_link")),
    );
    expect(JSON.stringify(log)).not.toContain(tokenOf(result.url));
  });

  it("asks for a code on a new phone, remembers the phone once it is right", async () => {
    const renterId = await addRenter();
    const result = await sendDetailsLink(deps, actor, renterId, 7);
    const visit = (await openLink(web.db, tokenOf((result as { url: string }).url)))!;
    expect(await isPhoneRemembered(web.db, visit, undefined)).toBe(false);

    expect(await sendLinkCode(deps, visit)).toBe("sent");
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await checkLinkCode(deps, visit, wrong)).toEqual({ status: "wrong", triesLeft: 4 });
    const right = await checkLinkCode(deps, visit, code);
    if (right.status !== "right") {
      throw new Error(right.status);
    }
    expect(await isPhoneRemembered(web.db, visit, right.deviceToken)).toBe(true);
    expect(await isPhoneRemembered(web.db, visit, "someone-elses-cookie")).toBe(false);
    // A code is used up once it is right.
    expect(await checkLinkCode(deps, visit, code)).toEqual({ status: "expired" });
  });

  it("locks after 5 wrong codes, and sends at most 3 codes an hour", async () => {
    const renterId = await addRenter();
    const result = await sendDetailsLink(deps, actor, renterId, 7);
    const visit = (await openLink(web.db, tokenOf((result as { url: string }).url)))!;
    expect(await sendLinkCode(deps, visit)).toBe("sent");
    expect(await sendLinkCode(deps, visit)).toBe("sent");
    expect(await sendLinkCode(deps, visit)).toBe("sent");
    expect(await sendLinkCode(deps, visit)).toBe("too_many");
    const wrong = lastCode() === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i += 1) {
      await checkLinkCode(deps, visit, wrong);
    }
    expect(await checkLinkCode(deps, visit, wrong)).toEqual({ status: "locked" });
    expect(await checkLinkCode(deps, visit, lastCode())).toEqual({ status: "locked" });
    expect(await loadDetailsLink(web.db, actor.operatorId, renterId, new Date())).toMatchObject({
      isLocked: true,
    });
  });

  it("stops the old link when a new one is sent or it is cancelled, and when it expires", async () => {
    const renterId = await addRenter();
    const first = (await sendDetailsLink(deps, actor, renterId, 7)) as { url: string };
    const second = (await sendDetailsLink(deps, actor, renterId, 7)) as { url: string };
    expect(await openLink(web.db, tokenOf(first.url))).toBeNull();
    expect(await openLink(web.db, tokenOf(second.url))).not.toBeNull();

    expect(await cancelDetailsLink(web.db, actor, renterId, new Date())).toBe("cancelled");
    expect(await openLink(web.db, tokenOf(second.url))).toBeNull();
    expect(await loadDetailsLink(web.db, actor.operatorId, renterId, new Date())).toBeNull();

    const longAgo = { ...deps, now: () => new Date(Date.now() - 8 * DAY_MS) };
    const expired = (await sendDetailsLink(longAgo, actor, renterId, 7)) as { url: string };
    expect(await openLink(web.db, tokenOf(expired.url))).toBeNull();
  });

  it("needs an email, and keeps one Operator's links from another", async () => {
    expect(await sendDetailsLink(deps, actor, await addRenter(null), 7)).toEqual({
      status: "no_email",
    });
    const renterId = await addRenter();
    expect(await sendDetailsLink(deps, otherActor, renterId, 7)).toEqual({ status: "not_found" });
    await sendDetailsLink(deps, actor, renterId, 7);
    expect(await cancelDetailsLink(web.db, otherActor, renterId, new Date())).toBe("none");
    expect(await loadDetailsLink(web.db, otherActor.operatorId, renterId, new Date())).toBeNull();
  });
});
