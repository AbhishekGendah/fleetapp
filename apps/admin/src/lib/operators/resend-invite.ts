import { operatorDisplayName } from "@fleetapp/core";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  operatorInvites,
  users,
} from "@fleetapp/db/schema";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { recordAdminActivity } from "./activity";
import type { OperatorActionDependencies, Transaction } from "./dependencies";
import { InviteAlreadyAcceptedError, OperatorSuspendedError } from "./errors";
import { deliverInvite, issueInvite } from "./invite";
import { lockOperator } from "./lock-operator";

/**
 * Cancels any invite still outstanding and sends a new one. The old link
 * cannot be sent again: only its fingerprint was kept.
 */
export async function resendInvite(
  deps: OperatorActionDependencies,
  adminUserId: string,
  operatorId: string,
): Promise<{ isInviteSent: boolean }> {
  const issuedAt = deps.now();

  const reissued = await deps.database.transaction(async (tx) => {
    const operator = await lockOperator(tx, operatorId);
    if (operator.suspendedAt) {
      throw new OperatorSuspendedError();
    }

    const user = await findInvitedUser(tx, operatorId);
    await revokeOutstandingInvites(tx, { operatorId, adminUserId, revokedAt: issuedAt });
    const invite = await issueInvite(tx, { operatorId, userId: user.id, adminUserId, issuedAt });

    return { operator, user, invite };
  });

  const isInviteSent = await deliverInvite(deps, {
    invite: reissued.invite,
    operatorId,
    operatorName: operatorDisplayName(reissued.operator),
    adminUserId,
    to: reissued.user.email,
    inviteeName: reissued.user.fullName,
  });

  return { isInviteSent };
}

/** v1 has exactly one User per Operator: the one created with it. */
async function findInvitedUser(
  tx: Transaction,
  operatorId: string,
): Promise<{ id: string; email: string; fullName: string }> {
  const [user] = await tx
    .select({ id: users.id, email: users.email, fullName: users.fullName })
    .from(users)
    .where(eq(users.operatorId, operatorId))
    .orderBy(asc(users.createdAt))
    .limit(1);
  if (!user) {
    throw new Error("This Operator has no User to invite.");
  }

  const [accepted] = await tx
    .select({ id: operatorInvites.id })
    .from(operatorInvites)
    .where(and(eq(operatorInvites.userId, user.id), isNotNull(operatorInvites.acceptedAt)))
    .limit(1);
  if (accepted) {
    throw new InviteAlreadyAcceptedError();
  }

  return user;
}

async function revokeOutstandingInvites(
  tx: Transaction,
  input: { operatorId: string; adminUserId: string; revokedAt: Date },
): Promise<void> {
  const revoked = await tx
    .update(operatorInvites)
    .set({ revokedAt: input.revokedAt })
    .where(
      and(
        eq(operatorInvites.operatorId, input.operatorId),
        isNull(operatorInvites.acceptedAt),
        isNull(operatorInvites.revokedAt),
      ),
    )
    .returning({ id: operatorInvites.id });

  for (const invite of revoked) {
    await recordAdminActivity(tx, {
      operatorId: input.operatorId,
      adminUserId: input.adminUserId,
      entityType: ACTIVITY_ENTITY_TYPES.operatorInvite,
      entityId: invite.id,
      action: ACTIVITY_ACTIONS.revoked,
    });
  }
}
