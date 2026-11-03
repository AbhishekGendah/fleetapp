import { describeErrorForLog, MILLISECONDS_PER_DAY, SIGNING_LINK_DAYS } from "@fleetapp/core";
import { generateSecretToken, hashSecretToken } from "@fleetapp/core/server";
import { recordActivity, type ActivityEntry } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  renterLinkDevices,
  renterLinks,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { renderRenterPaymentsLinkEmail } from "@fleetapp/email";
import { eq } from "drizzle-orm";

import type { ActingUser } from "../acting-user";
import { cancelLinksAs } from "../renter-links/cancel-links";
import {
  loadLinkInPlay,
  renterLinkUrl,
  type LinkDependencies,
  type RenterLinkInPlay,
} from "../renter-links/details-links";
import { loadLinkSender } from "../renter-links/link-email";
import type { LinkVisit } from "../renter-links/link-visits";
import {
  findPaymentsRental,
  isStripeOfferedToRenters,
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

/** Emails the link; false if the email failed, so the Operator can hand it over another way. */
async function emailPaymentsLink(
  deps: PaymentsLinkDependencies,
  tx: AnyTransaction,
  to: { operatorId: string; email: string; renterName: string; carRego: string },
  issued: IssuedLink,
): Promise<boolean> {
  const sender = await loadLinkSender(tx, to.operatorId);
  try {
    await deps.emailSender.send(
      await renderRenterPaymentsLinkEmail({
        to: to.email,
        renterName: to.renterName,
        operatorName: sender.operatorName,
        replyTo: sender.replyTo,
        rentalSummary: to.carRego,
        linkUrl: renterLinkUrl(deps.appUrl, issued.token),
        validUntil: deps.describeDay(issued.expiresAt),
      }),
    );
    return true;
  } catch (error) {
    // Never the error's details: they could hold the link's address.
    console.error("Emailing a payments link failed", describeErrorForLog(error));
    return false;
  }
}

export type SendPaymentsLinkResult =
  | { status: "sent"; url: string; expiresAt: Date; isEmailed: boolean }
  | { status: "not_offered" | "not_found" | "no_email" };

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
  return withTenant(deps.database, actor.operatorId, async (tx) => {
    const rental = await findPaymentsRental(tx, {
      operatorId: actor.operatorId,
      rentalId,
      renterId: null,
    });
    if (!rental) {
      return { status: "not_found" as const };
    }
    if (!rental.renterEmail) {
      return { status: "no_email" as const };
    }
    const issued = await issuePaymentsLink(
      tx,
      { operatorId: actor.operatorId, type: "user", id: actor.userId },
      {
        renterId: rental.renterId,
        rentalId,
        email: rental.renterEmail,
        createdByUserId: actor.userId,
        now,
      },
    );
    const isEmailed =
      delivery === "email" &&
      (await emailPaymentsLink(
        deps,
        tx,
        {
          operatorId: actor.operatorId,
          email: rental.renterEmail,
          renterName: rental.renterName,
          carRego: rental.carRego,
        },
        issued,
      ));
    return {
      status: "sent" as const,
      url: renterLinkUrl(deps.appUrl, issued.token),
      expiresAt: issued.expiresAt,
      isEmailed,
    };
  });
}

/** The payments link the Renter goes on to, already remembered on the phone they signed on. */
export interface ContinuedLink {
  token: string;
  deviceToken: string;
  expiresAt: Date;
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
  return withTenant(deps.database, signing.operatorId, async (tx) => {
    const rental = await findPaymentsRental(tx, {
      operatorId: signing.operatorId,
      rentalId: signing.rentalId,
      renterId: signing.renterId,
    });
    const [link] = await tx
      .select({ createdByUserId: renterLinks.createdByUserId, email: renterLinks.sentToEmail })
      .from(renterLinks)
      .where(eq(renterLinks.id, signing.linkId));
    if (!rental || !link) {
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
        email: link.email,
        createdByUserId: link.createdByUserId,
        now,
      },
    );
    const deviceToken = generateSecretToken();
    await tx.insert(renterLinkDevices).values({
      operatorId: signing.operatorId,
      linkId: issued.linkId,
      deviceTokenHash: hashSecretToken(deviceToken),
    });
    await emailPaymentsLink(
      deps,
      tx,
      {
        operatorId: signing.operatorId,
        email: link.email,
        renterName: rental.renterName,
        carRego: rental.carRego,
      },
      issued,
    );
    return { token: issued.token, deviceToken, expiresAt: issued.expiresAt };
  });
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
