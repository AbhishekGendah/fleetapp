import { describeErrorForLog, MILLISECONDS_PER_DAY, SIGNING_LINK_DAYS } from "@fleetapp/core";
import { generateSecretToken, hashSecretToken } from "@fleetapp/core/server";
import { recordActivity, type ActivityEntry } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, renterLinks } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { renderRenterPaymentsLinkEmail, type EmailMessage } from "@fleetapp/email";
import { and, eq } from "drizzle-orm";

import { isRentalRenterArchived } from "../renters/renter-archived";
import type { ActingUser } from "../acting-user";
import { lockLinkRecipient } from "../renters/renter-records";
import { cancelLinksAs } from "../renter-links/cancel-links";
import {
  loadLinkInPlay,
  renterLinkUrl,
  type LinkDependencies,
  type RenterLinkInPlay,
} from "../renter-links/details-links";
import { loadLinkSender } from "../renter-links/link-email";
import { rentalSummaryText } from "../contracts/signing-links";
import { rememberPhone, type LinkVisit } from "../renter-links/link-visits";
import {
  findPaymentsRental,
  isStripeOfferedToRenters,
  type PaymentsRental,
  type RenterCheckoutDependencies,
} from "./renter-checkout";
import { rentalPaymentsIn } from "./renter-payment-records";

const PURPOSE = "set_up_payments";

export type PaymentsLinkDependencies = LinkDependencies & RenterCheckoutDependencies;

/** How the Operator hands the link over: by email, or as a code the Renter scans there and then. */
export type PaymentsLinkDelivery = "email" | "on_the_spot";

/** A new payments link: its address is shown once (emailed, or as a code to scan) and never again. */
interface IssuedLink {
  linkId: string;
  token: string;
  expiresAt: Date;
}

/**
 * Issues the rental's payments link (rule 26): for this rental only,
 * lasting a week, replacing any payments link still in play for it. The
 * one-time codes go to the Renter's email, so it needs one on file.
 */
async function issuePaymentsLink(
  tx: AnyTransaction,
  by: { operatorId: string } & ActivityEntry["actor"],
  link: { renterId: string; rentalId: string; email: string; createdByUserId: string; now: Date },
): Promise<IssuedLink> {
  const token = generateSecretToken();
  const expiresAt = new Date(link.now.getTime() + SIGNING_LINK_DAYS * MILLISECONDS_PER_DAY);
  await cancelLinksAs(tx, by, {
    renterId: link.renterId,
    now: link.now,
    which: { purpose: PURPOSE, rentalId: link.rentalId },
  });
  const [added] = await tx
    .insert(renterLinks)
    .values({
      operatorId: by.operatorId,
      renterId: link.renterId,
      purpose: PURPOSE,
      tokenHash: hashSecretToken(token),
      sentToEmail: link.email,
      expiresAt,
      createdByUserId: link.createdByUserId,
      rentalId: link.rentalId,
      createdAt: link.now,
      updatedAt: link.now,
    })
    .returning({ id: renterLinks.id });
  if (!added) {
    throw new Error("The link was not saved.");
  }
  await recordActivity(tx, {
    operatorId: by.operatorId,
    actor: { type: by.type, id: by.id },
    entityType: ACTIVITY_ENTITY_TYPES.renterLink,
    entityId: added.id,
    action: ACTIVITY_ACTIONS.sent,
    valuesAfter: {
      renterId: link.renterId,
      rentalId: link.rentalId,
      purpose: PURPOSE,
      expiresAt: expiresAt.toISOString(),
    },
  });
  return { linkId: added.id, token, expiresAt };
}

/** The rental a payments email is for, named the way the Renter knows it (review KL-6). */
interface PaymentsEmailTo {
  operatorId: string;
  email: string;
  renterName: string;
  rental: PaymentsRental;
}

/**
 * The payments link email, made inside the transaction that saves the link
 * but sent only after it is saved (review KS-5), so a link that failed to
 * save is never emailed.
 */
async function preparePaymentsLinkEmail(
  deps: PaymentsLinkDependencies,
  tx: AnyTransaction,
  to: PaymentsEmailTo,
  issued: IssuedLink,
): Promise<EmailMessage> {
  const sender = await loadLinkSender(tx, to.operatorId);
  return renderRenterPaymentsLinkEmail({
    to: to.email,
    renterName: to.renterName,
    operatorName: sender.operatorName,
    replyTo: sender.replyTo,
    rentalSummary: rentalSummaryText({
      carRego: to.rental.carRego,
      carMakeModel: to.rental.carMakeModel,
      rentalStart: deps.describeDay(to.rental.plannedStart),
    }),
    linkUrl: renterLinkUrl(deps.appUrl, issued.token),
    validUntil: deps.describeMoment(issued.expiresAt),
  });
}

/** Sends a prepared email; false if it failed, so the Operator can hand the link over another way. */
async function sendPrepared(
  deps: PaymentsLinkDependencies,
  message: EmailMessage,
): Promise<boolean> {
  try {
    await deps.emailSender.send(message);
    return true;
  } catch (error) {
    // Never the error's details: they could hold the link's address.
    console.error("Emailing a payments link failed", describeErrorForLog(error));
    return false;
  }
}

export type SendPaymentsLinkResult =
  | { status: "sent"; url: string; expiresAt: Date; isEmailed: boolean }
  | { status: "not_offered" | "not_found" | "no_email" | "renter_archived" };

/**
 * The Operator sends the Renter their payments link: emailed, or shown on
 * the Operator's phone as a code to scan there and then (the Renter still
 * types the emailed one-time code, and their own bank details, themselves).
 * Also how a Renter changes bank account: a new direct debit replaces the old.
 */
export async function sendPaymentsLink(
  deps: PaymentsLinkDependencies,
  actor: ActingUser,
  rentalId: string,
  delivery: PaymentsLinkDelivery,
): Promise<SendPaymentsLinkResult> {
  if (!(await isStripeOfferedToRenters(deps, actor.operatorId))) {
    return { status: "not_offered" };
  }
  const now = deps.now();
  const saved = await withTenant(deps.database, actor.operatorId, async (tx) => {
    const rental = await findPaymentsRental(tx, {
      operatorId: actor.operatorId,
      rentalId,
      renterId: null,
    });
    if (!rental) {
      return (await isRentalRenterArchived(tx, actor.operatorId, rentalId))
        ? { status: "renter_archived" as const }
        : { status: "not_found" as const };
    }
    const recipient = await lockLinkRecipient(tx, actor.operatorId, rental.renterId);
    if (recipient.status !== "found") {
      return { status: recipient.status };
    }
    const issued = await issuePaymentsLink(
      tx,
      { operatorId: actor.operatorId, type: "user", id: actor.userId },
      {
        renterId: rental.renterId,
        rentalId,
        email: recipient.email,
        createdByUserId: actor.userId,
        now,
      },
    );
    const email =
      delivery === "email"
        ? await preparePaymentsLinkEmail(
            deps,
            tx,
            {
              operatorId: actor.operatorId,
              email: recipient.email,
              renterName: rental.greetingName,
              rental,
            },
            issued,
          )
        : null;
    return { status: "saved" as const, issued, email };
  });
  if (saved.status !== "saved") {
    return saved;
  }
  const isEmailed = saved.email !== null && (await sendPrepared(deps, saved.email));
  return {
    status: "sent",
    url: renterLinkUrl(deps.appUrl, saved.issued.token),
    expiresAt: saved.issued.expiresAt,
    isEmailed,
  };
}

/** The payments link the Renter goes on to, already remembered on the phone they signed on. */
export interface ContinuedLink {
  token: string;
  deviceToken: string;
  expiresAt: Date;
}

/**
 * The signing link, read under the Renter's lock, while it still speaks for
 * the Renter's email on file: this phone passed a code sent to the email
 * the link went to, so once the email changed (which cancels live links)
 * the phone is not remembered for a new link. The Operator then sends the
 * payments link the usual way, and a new phone types a code from the new
 * email (rule 26).
 */
async function signingLinkStillTo(
  tx: AnyTransaction,
  signing: LinkVisit,
  email: string,
): Promise<{ createdByUserId: string } | null> {
  const [link] = await tx
    .select({
      createdByUserId: renterLinks.createdByUserId,
      sentToEmail: renterLinks.sentToEmail,
      cancelledAt: renterLinks.cancelledAt,
    })
    .from(renterLinks)
    .where(and(eq(renterLinks.id, signing.linkId), eq(renterLinks.operatorId, signing.operatorId)));
  const isStillTo = link !== undefined && link.cancelledAt === null && link.sentToEmail === email;
  return isStillTo ? { createdByUserId: link.createdByUserId } : null;
}

/**
 * Right after the Renter signs their contract: if the business takes
 * payments by Stripe and the direct debit or bond is still to do, a
 * payments link is made and this phone is remembered for it, so they carry
 * straight on without a second code. It is emailed too, to come back to.
 * The signing link itself is already used up (rule 26: one purpose each).
 */
export async function continueToPayments(
  deps: PaymentsLinkDependencies,
  signing: LinkVisit,
): Promise<ContinuedLink | null> {
  if (signing.purpose !== "sign_contract" || !signing.rentalId) {
    return null;
  }
  if (!(await isStripeOfferedToRenters(deps, signing.operatorId))) {
    return null;
  }
  const now = deps.now();
  const continued = await withTenant(deps.database, signing.operatorId, async (tx) => {
    const rental = await findPaymentsRental(tx, {
      operatorId: signing.operatorId,
      rentalId: signing.rentalId,
      renterId: signing.renterId,
    });
    if (!rental) {
      return null;
    }
    const recipient = await lockLinkRecipient(tx, signing.operatorId, signing.renterId);
    if (recipient.status !== "found") {
      return null;
    }
    const link = await signingLinkStillTo(tx, signing, recipient.email);
    if (!link) {
      return null;
    }
    const due = await rentalPaymentsIn(tx, signing.operatorId, rental);
    if (due.directDebit === "active" && due.bond.toCollectCents === 0) {
      return null;
    }
    const issued = await issuePaymentsLink(
      tx,
      { operatorId: signing.operatorId, type: "renter_link", id: signing.linkId },
      {
        renterId: signing.renterId,
        rentalId: rental.id,
        email: recipient.email,
        createdByUserId: link.createdByUserId,
        now,
      },
    );
    const deviceToken = await rememberPhone(tx, {
      operatorId: signing.operatorId,
      linkId: issued.linkId,
    });
    // The phone that signed goes straight on, so it is remembered: logged like a code typed (review KL-7).
    await recordActivity(tx, {
      operatorId: signing.operatorId,
      actor: { type: "renter_link", id: signing.linkId },
      entityType: ACTIVITY_ENTITY_TYPES.renterLink,
      entityId: issued.linkId,
      action: ACTIVITY_ACTIONS.phoneVerified,
      valuesAfter: { renterId: signing.renterId, fromSigning: true },
    });
    const email = await preparePaymentsLinkEmail(
      deps,
      tx,
      {
        operatorId: signing.operatorId,
        email: recipient.email,
        renterName: rental.greetingName,
        rental,
      },
      issued,
    );
    return { link: { token: issued.token, deviceToken, expiresAt: issued.expiresAt }, email };
  });
  if (!continued) {
    return null;
  }
  // After the save; the signing page doesn't wait on a slow email service's answer.
  await sendPrepared(deps, continued.email);
  return continued.link;
}

/** The rental's payments link still in play (maybe expired or locked), or null. */
export function loadPaymentsLink(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
  now: Date,
): Promise<RenterLinkInPlay | null> {
  return loadLinkInPlay(database, operatorId, { purpose: PURPOSE, rentalId }, now);
}
