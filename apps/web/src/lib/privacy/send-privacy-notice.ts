import { describeErrorForLog, privacyNoticeFor } from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, renters } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { renderRenterPrivacyNoticeEmail, type EmailSender } from "@fleetapp/email";
import { BRAND } from "@fleetapp/ui/brand";
import { and, eq } from "drizzle-orm";

import type { ActingUser } from "../acting-user";
import { loadDrivesForNames } from "../renters/organisation-driver-queries";
import { loadNoticeBusiness } from "./notice-business";

/** What happened to the notice: sent, or why the business must hand it over itself. */
export type PrivacyNoticeOutcome = "sent" | "no_email" | "not_sent";

/** Which message the Renter's page shows when the notice was not emailed. */
export const NOTICE_PARAM = "notice";

/** What the history says was emailed: which message, never its contents. */
const NOTICE_EMAIL_NAME = "privacy_notice";

/**
 * Emails the privacy notice to a Renter the business added itself, e.g. at
 * the counter, who has not seen it on a link (APP 5; review A5-10), or to a
 * person just added as a business's driver, so they know what it sees. Saving
 * the Renter never waits on it: a failed send is logged by type only and
 * reported, so the business hands the Renter a copy instead.
 */
export async function sendPrivacyNotice(
  deps: { database: AnyDatabase; emailSender: EmailSender },
  actor: ActingUser,
  renterId: string,
): Promise<PrivacyNoticeOutcome> {
  let outcome: PrivacyNoticeOutcome;
  try {
    outcome = await emailNotice(deps, actor, renterId);
  } catch (error) {
    console.error("Emailing a privacy notice failed", describeErrorForLog(error));
    return "not_sent";
  }
  if (outcome === "sent") {
    // It went: a history line that can't be written is logged, never reported as unsent.
    await recordNoticeSent(deps.database, actor, renterId).catch((error: unknown) =>
      console.error("Recording a privacy notice email failed", describeErrorForLog(error)),
    );
  }
  return outcome;
}

async function emailNotice(
  deps: { database: AnyDatabase; emailSender: EmailSender },
  actor: ActingUser,
  renterId: string,
): Promise<PrivacyNoticeOutcome> {
  const [renter] = await withTenant(deps.database, actor.operatorId, (tx) =>
    tx
      .select({
        email: renters.email,
        fullName: renters.fullName,
        preferredName: renters.preferredName,
        contactName: renters.contactName,
      })
      .from(renters)
      .where(and(eq(renters.operatorId, actor.operatorId), eq(renters.id, renterId))),
  );
  if (!renter?.email) {
    return "no_email";
  }
  const [business, drivesFor] = await Promise.all([
    loadNoticeBusiness(deps.database, actor.operatorId),
    loadDrivesForNames(deps.database, actor.operatorId, renterId),
  ]);
  const message = await renderRenterPrivacyNoticeEmail({
    to: renter.email,
    replyTo: business.email ?? undefined,
    // A business's email is its contact's, so the notice greets them.
    renterName: renter.contactName ?? renter.preferredName ?? renter.fullName,
    operatorName: business.name,
    notice: privacyNoticeFor(business, BRAND.productName, "counter", drivesFor),
  });
  await deps.emailSender.send(message);
  return "sent";
}

function recordNoticeSent(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
): Promise<void> {
  return withTenant(database, actor.operatorId, (tx) =>
    recordActivity(tx, {
      operatorId: actor.operatorId,
      actor: { type: "user", id: actor.userId },
      entityType: ACTIVITY_ENTITY_TYPES.renter,
      entityId: renterId,
      action: ACTIVITY_ACTIONS.sent,
      valuesAfter: { email: NOTICE_EMAIL_NAME },
    }),
  );
}
