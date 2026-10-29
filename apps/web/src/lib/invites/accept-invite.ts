import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  operatorInvites,
  userAccounts,
  users,
} from "@fleetapp/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";

import type { UserAuth } from "../auth-options";
import { findUsableInvite } from "./find-invite";

/** Better Auth's name for a password login. */
const CREDENTIAL_PROVIDER_ID = "credential";

export class InviteNotUsableError extends Error {
  constructor() {
    super("This invite link no longer works. Ask for a new one.");
    this.name = "InviteNotUsableError";
  }
}

export interface AcceptInviteInput {
  database: AnyDatabase;
  auth: UserAuth;
  token: string;
  password: string;
  now: Date;
}

/**
 * Turns an invite into a login: the password, and the email marked verified
 * (the invite reaching them proves the address).
 *
 * The invite is claimed with a conditional update inside the transaction, so
 * of two acceptances at once exactly one gets the row and the other fails
 * cleanly. Nothing is written unless the claim succeeds.
 */
export async function acceptInvite(input: AcceptInviteInput): Promise<{ email: string }> {
  const invite = await findUsableInvite(input.database, input.token, input.now);
  if (!invite) {
    throw new InviteNotUsableError();
  }

  const { password: passwordHasher } = await input.auth.$context;
  const hashedPassword = await passwordHasher.hash(input.password);

  await input.database.transaction(async (tx) => {
    const claimed = await tx
      .update(operatorInvites)
      .set({ acceptedAt: input.now })
      .where(
        and(
          eq(operatorInvites.id, invite.inviteId),
          isNull(operatorInvites.acceptedAt),
          isNull(operatorInvites.revokedAt),
          gt(operatorInvites.expiresAt, input.now),
        ),
      )
      .returning({ id: operatorInvites.id });
    if (claimed.length === 0) {
      throw new InviteNotUsableError();
    }

    await tx.insert(userAccounts).values({
      operatorId: invite.operatorId,
      userId: invite.userId,
      accountId: invite.userId,
      providerId: CREDENTIAL_PROVIDER_ID,
      password: hashedPassword,
      updatedAt: input.now,
    });
    await tx
      .update(users)
      .set({ emailVerified: true, updatedAt: input.now })
      .where(eq(users.id, invite.userId));
    await recordActivity(tx, {
      operatorId: invite.operatorId,
      actor: { type: "user", id: invite.userId },
      entityType: ACTIVITY_ENTITY_TYPES.operatorInvite,
      entityId: invite.inviteId,
      action: ACTIVITY_ACTIONS.accepted,
    });
  });

  return { email: invite.email };
}
