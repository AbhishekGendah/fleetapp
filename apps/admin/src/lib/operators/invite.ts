import { describeErrorForLog } from "@fleetapp/core";
import { buildInviteUrl, getInviteExpiry } from "@fleetapp/core";
import { generateSecretToken, hashSecretToken } from "@fleetapp/core/server";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, operatorInvites } from "@fleetapp/db/schema";
import { renderOperatorInviteEmail } from "@fleetapp/email";
import { eq } from "drizzle-orm";

import { recordAdminActivity } from "./activity";
import type { OperatorActionDependencies, Transaction } from "./dependencies";

export interface IssueInviteInput {
  operatorId: string;
  userId: string;
  adminUserId: string;
  issuedAt: Date;
}

export interface IssuedInvite {
  inviteId: string;
  /** The secret for the link. Exists only in memory and in the email. */
  token: string;
}

/** Creates an invite and its log line. Only the token's fingerprint is stored. */
export async function issueInvite(tx: Transaction, input: IssueInviteInput): Promise<IssuedInvite> {
  const token = generateSecretToken();
  const expiresAt = getInviteExpiry(input.issuedAt);

  const [invite] = await tx
    .insert(operatorInvites)
    .values({
      operatorId: input.operatorId,
      userId: input.userId,
      tokenHash: hashSecretToken(token),
      expiresAt,
      createdByAdminId: input.adminUserId,
      createdAt: input.issuedAt,
    })
    .returning({ id: operatorInvites.id });

  if (!invite) {
    throw new Error("The invite was not created.");
  }

  await recordAdminActivity(tx, {
    operatorId: input.operatorId,
    adminUserId: input.adminUserId,
    entityType: ACTIVITY_ENTITY_TYPES.operatorInvite,
    entityId: invite.id,
    action: ACTIVITY_ACTIONS.created,
    valuesAfter: { expiresAt: expiresAt.toISOString() },
  });

  return { inviteId: invite.id, token };
}

export interface DeliverInviteInput {
  invite: IssuedInvite;
  operatorId: string;
  operatorName: string;
  adminUserId: string;
  to: string;
  inviteeName: string;
}

async function recordInviteSent(
  deps: OperatorActionDependencies,
  input: DeliverInviteInput,
): Promise<void> {
  const sentAt = deps.now();
  await deps.database.transaction(async (tx) => {
    await tx
      .update(operatorInvites)
      .set({ sentAt })
      .where(eq(operatorInvites.id, input.invite.inviteId));
    await recordAdminActivity(tx, {
      operatorId: input.operatorId,
      adminUserId: input.adminUserId,
      entityType: ACTIVITY_ENTITY_TYPES.operatorInvite,
      entityId: input.invite.inviteId,
      action: ACTIVITY_ACTIONS.sent,
    });
  });
}

/**
 * Sends the invite email, then records that it went.
 *
 * Runs after the invite is committed, never inside its transaction: an email
 * cannot be unsent if the transaction later rolls back. A failure is returned
 * rather than thrown, because by now the Operator exists and the right
 * response is "Not sent", with Resend beside it.
 */
export async function deliverInvite(
  deps: OperatorActionDependencies,
  input: DeliverInviteInput,
): Promise<boolean> {
  try {
    const message = await renderOperatorInviteEmail({
      to: input.to,
      inviteeName: input.inviteeName,
      operatorName: input.operatorName,
      acceptUrl: buildInviteUrl(deps.appUrl, input.invite.token),
    });
    await deps.emailSender.send(message);
  } catch (error) {
    // Only the error's type and the invite's ID: a provider's message can
    // quote the recipient's address, and this goes to the hosting logs.
    console.error("Failed to send an Operator invite", {
      inviteId: input.invite.inviteId,
      ...describeErrorForLog(error),
    });
    return false;
  }
  // The email went: the screen says so even if noting it fails, so a Resend
  // never cancels a working link by mistake (review A9-8).
  await recordInviteSent(deps, input).catch((error: unknown) => {
    console.error("Failed to record an Operator invite as sent", {
      inviteId: input.invite.inviteId,
      ...describeErrorForLog(error),
    });
  });
  return true;
}
