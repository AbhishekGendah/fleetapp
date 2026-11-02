import {
  LINK_CODE_VALID_MINUTES,
  maskEmail,
  MILLISECONDS_PER_MINUTE,
  LINK_CODE_DIGITS,
  MAXIMUM_WRONG_LINK_CODES,
  MAXIMUM_LINK_CODES_PER_HOUR,
  type RenterLinkPurpose,
} from "@fleetapp/core";
import {
  generateLinkCode,
  generateSecretToken,
  hashLinkCode,
  hashSecretToken,
} from "@fleetapp/core/server";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  renterLinkDevices,
  renterLinks,
  type ActivityAction,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailSender } from "@fleetapp/email";
import { renderRenterLinkCodeEmail } from "@fleetapp/email";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { loadLinkSender } from "./link-email";

const CODE_WINDOW_MS = 60 * MILLISECONDS_PER_MINUTE;
const CODE_VALID_FOR = `${LINK_CODE_VALID_MINUTES} minutes`;

/** An open link, as its page knows it. Never the secret itself. */
export interface LinkVisit {
  operatorId: string;
  linkId: string;
  renterId: string;
  purpose: RenterLinkPurpose;
  operatorName: string;
  /** For the form's date checks: the Operator's today. */
  timeZone: string;
  /** "s•••@gmail.com": all the page shows before the code is right. */
  maskedEmail: string;
  expiresAt: Date;
  isLocked: boolean;
  /** When it was sent: a signing link's contract is filled in as of then. */
  sentAt: Date;
  /**
   * A signing link's rental, template version and the fingerprint of the
   * text it was sent for; and for a change of terms, the change.
   */
  signing: {
    rentalId: string;
    templateVersionId: string;
    contractFingerprint: string;
    rentalChangeId: string | null;
  } | null;
}

const lookupSchema = z.object({
  rows: z.array(z.object({ operator_id: z.uuid(), link_id: z.uuid() })),
});

/**
 * The live link behind the secret in an address, or null. No one is signed
 * in (rule 3): the narrow database function turns the fingerprint into its
 * Operator, and everything after runs inside that Operator's data only.
 */
export async function openLink(database: AnyDatabase, token: string): Promise<LinkVisit | null> {
  const result = await database.execute(
    sql`select operator_id, link_id from app.renter_link_for_token(${hashSecretToken(token)})`,
  );
  const [found] = lookupSchema.parse(result).rows;
  if (!found) {
    return null;
  }
  return withTenant(database, found.operator_id, async (tx) => {
    const [link] = await tx
      .select()
      .from(renterLinks)
      .where(and(eq(renterLinks.id, found.link_id), eq(renterLinks.operatorId, found.operator_id)));
    if (!link) {
      return null;
    }
    const sender = await loadLinkSender(tx, link.operatorId);
    return {
      operatorId: link.operatorId,
      linkId: link.id,
      renterId: link.renterId,
      purpose: link.purpose,
      operatorName: sender.operatorName,
      timeZone: sender.timeZone,
      maskedEmail: maskEmail(link.sentToEmail),
      expiresAt: link.expiresAt,
      isLocked: link.lockedAt !== null,
      sentAt: link.createdAt,
      signing:
        link.rentalId && link.templateVersionId && link.contractFingerprint
          ? {
              rentalId: link.rentalId,
              templateVersionId: link.templateVersionId,
              contractFingerprint: link.contractFingerprint,
              rentalChangeId: link.rentalChangeId,
            }
          : null,
    };
  });
}

/** Changes made through a link are the link's, not a User's (rule 19). */
function logLink(tx: AnyTransaction, visit: LinkVisit, action: ActivityAction): Promise<void> {
  return recordActivity(tx, {
    operatorId: visit.operatorId,
    actor: { type: "renter_link", id: visit.linkId },
    entityType: ACTIVITY_ENTITY_TYPES.renterLink,
    entityId: visit.linkId,
    action,
    valuesAfter: { renterId: visit.renterId },
  });
}

/** Whether this phone has typed a right code for this link before. */
export async function isPhoneRemembered(
  database: AnyDatabase,
  visit: LinkVisit,
  deviceToken: string | undefined,
): Promise<boolean> {
  if (!deviceToken) {
    return false;
  }
  const [device] = await withTenant(database, visit.operatorId, (tx) =>
    tx
      .select({ id: renterLinkDevices.id })
      .from(renterLinkDevices)
      .where(
        and(
          eq(renterLinkDevices.linkId, visit.linkId),
          eq(renterLinkDevices.deviceTokenHash, hashSecretToken(deviceToken)),
        ),
      ),
  );
  return device !== undefined;
}

async function lockLink(tx: AnyTransaction, linkId: string) {
  const [link] = await tx
    .select()
    .from(renterLinks)
    .where(eq(renterLinks.id, linkId))
    .for("update");
  if (!link) {
    throw new Error("The link vanished while it was open.");
  }
  return link;
}

export type SendCodeResult = "sent" | "too_many" | "locked";

/**
 * Emails a fresh code to the address the link went to, replacing any code
 * not yet used. At most 3 an hour, so a link cannot flood an inbox.
 */
export async function sendLinkCode(
  deps: { database: AnyDatabase; emailSender: EmailSender; now: () => Date },
  visit: LinkVisit,
): Promise<SendCodeResult> {
  const now = deps.now();
  const code = generateLinkCode();
  const outcome = await withTenant(deps.database, visit.operatorId, async (tx) => {
    const link = await lockLink(tx, visit.linkId);
    if (link.lockedAt) {
      return { status: "locked" as const };
    }
    const isNewWindow =
      !link.codesWindowStartedAt ||
      now.getTime() - link.codesWindowStartedAt.getTime() >= CODE_WINDOW_MS;
    const codesInWindow = isNewWindow ? 0 : link.codesInWindow;
    if (codesInWindow >= MAXIMUM_LINK_CODES_PER_HOUR) {
      return { status: "too_many" as const };
    }
    await tx
      .update(renterLinks)
      .set({
        codeHash: hashLinkCode(link.id, code),
        codeExpiresAt: new Date(now.getTime() + LINK_CODE_VALID_MINUTES * MILLISECONDS_PER_MINUTE),
        codesWindowStartedAt: isNewWindow ? now : link.codesWindowStartedAt,
        codesInWindow: codesInWindow + 1,
        updatedAt: now,
      })
      .where(eq(renterLinks.id, link.id));
    await logLink(tx, visit, ACTIVITY_ACTIONS.codeSent);
    return {
      status: "send" as const,
      email: link.sentToEmail,
      sender: await loadLinkSender(tx, link.operatorId),
    };
  });
  if (outcome.status !== "send") {
    return outcome.status;
  }
  await deps.emailSender.send(
    await renderRenterLinkCodeEmail({
      to: outcome.email,
      operatorName: outcome.sender.operatorName,
      replyTo: outcome.sender.replyTo,
      code,
      validFor: CODE_VALID_FOR,
    }),
  );
  return "sent";
}

export type CheckCodeResult =
  | { status: "right"; deviceToken: string }
  | { status: "incomplete" }
  | { status: "wrong"; triesLeft: number }
  | { status: "expired" }
  | { status: "locked" };

/**
 * Checks a typed code. Right: the code is used up and this phone is
 * remembered for the link (its cookie's fingerprint is kept). Wrong 10 times
 * over the link's life (`code_tries` is never reset): the link locks, and
 * the Operator must send a new one. Fewer than 6 digits is not a guess.
 */
export async function checkLinkCode(
  deps: { database: AnyDatabase; now: () => Date },
  visit: LinkVisit,
  typedCode: string,
): Promise<CheckCodeResult> {
  const now = deps.now();
  if (typedCode.length !== LINK_CODE_DIGITS) {
    return { status: "incomplete" };
  }
  return withTenant(deps.database, visit.operatorId, async (tx): Promise<CheckCodeResult> => {
    const link = await lockLink(tx, visit.linkId);
    if (link.lockedAt) {
      return { status: "locked" };
    }
    if (!link.codeHash || !link.codeExpiresAt || link.codeExpiresAt <= now) {
      return { status: "expired" };
    }
    if (hashLinkCode(link.id, typedCode) === link.codeHash) {
      const deviceToken = generateSecretToken();
      await tx
        .update(renterLinks)
        .set({ codeHash: null, codeExpiresAt: null, updatedAt: now })
        .where(eq(renterLinks.id, link.id));
      await tx.insert(renterLinkDevices).values({
        operatorId: link.operatorId,
        linkId: link.id,
        deviceTokenHash: hashSecretToken(deviceToken),
      });
      await logLink(tx, visit, ACTIVITY_ACTIONS.phoneVerified);
      return { status: "right", deviceToken };
    }
    const tries = link.codeTries + 1;
    const isNowLocked = tries >= MAXIMUM_WRONG_LINK_CODES;
    await tx
      .update(renterLinks)
      .set({ codeTries: tries, lockedAt: isNowLocked ? now : null, updatedAt: now })
      .where(eq(renterLinks.id, link.id));
    if (isNowLocked) {
      await logLink(tx, visit, ACTIVITY_ACTIONS.locked);
      return { status: "locked" };
    }
    return { status: "wrong", triesLeft: MAXIMUM_WRONG_LINK_CODES - tries };
  });
}

/**
 * The open link behind a secret, only if it is for one of `purposes` and this phone
 * has passed its code. Every step a Renter takes starts here, so a page left
 * open on another phone, a forwarded link, or a link sent for something else
 * (a signing link used on the details form) can do nothing.
 */
export async function openVerifiedLink(
  database: AnyDatabase,
  token: string,
  deviceToken: string | undefined,
  purposes: RenterLinkPurpose | readonly RenterLinkPurpose[],
): Promise<LinkVisit | null> {
  const visit = await openLink(database, token);
  const allowed: readonly RenterLinkPurpose[] =
    typeof purposes === "string" ? [purposes] : purposes;
  if (
    !visit ||
    !allowed.includes(visit.purpose) ||
    visit.isLocked ||
    !(await isPhoneRemembered(database, visit, deviceToken))
  ) {
    return null;
  }
  return visit;
}
