import { operatorDisplayName } from "@fleetapp/core";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, operators, users } from "@fleetapp/db/schema";

import { recordAdminActivity } from "./activity";
import type { OperatorActionDependencies, Transaction } from "./dependencies";
import { EmailAlreadyInUseError } from "./errors";
import { deliverInvite, issueInvite, type IssuedInvite } from "./invite";
import type { CreateOperatorInput } from "./operator-input";
import { isUniqueViolation } from "./postgres-errors";

/** The index that keeps one login per email across the whole platform. */
const USERS_EMAIL_UNIQUE_INDEX = "users_email_unique";

export interface CreateOperatorResult {
  operatorId: string;
  isInviteSent: boolean;
}

/**
 * Creates the Operator, its User and an invite in one transaction, so either
 * all three exist or none do. Then sends the invite.
 */
export async function createOperator(
  deps: OperatorActionDependencies,
  adminUserId: string,
  input: CreateOperatorInput,
): Promise<CreateOperatorResult> {
  const createdAt = deps.now();

  const created = await deps.database
    .transaction((tx) => insertOperatorRecords(tx, adminUserId, input, createdAt))
    .catch((error: unknown) => {
      if (isUniqueViolation(error, USERS_EMAIL_UNIQUE_INDEX)) {
        throw new EmailAlreadyInUseError();
      }
      throw error;
    });

  const isInviteSent = await deliverInvite(deps, {
    invite: created.invite,
    operatorId: created.operatorId,
    operatorName: operatorDisplayName(input),
    adminUserId,
    to: input.userEmail,
    inviteeName: input.userFullName,
  });

  return { operatorId: created.operatorId, isInviteSent };
}

async function insertOperatorRecords(
  tx: Transaction,
  adminUserId: string,
  input: CreateOperatorInput,
  createdAt: Date,
): Promise<{ operatorId: string; invite: IssuedInvite }> {
  const [operator] = await tx
    .insert(operators)
    .values({ legalName: input.legalName, tradingName: input.tradingName })
    .returning({ id: operators.id });
  if (!operator) {
    throw new Error("The Operator was not created.");
  }

  const [user] = await tx
    .insert(users)
    .values({ operatorId: operator.id, email: input.userEmail, fullName: input.userFullName })
    .returning({ id: users.id });
  if (!user) {
    throw new Error("The User was not created.");
  }

  const logEntry = { operatorId: operator.id, adminUserId, action: ACTIVITY_ACTIONS.created };
  await recordAdminActivity(tx, {
    ...logEntry,
    entityType: ACTIVITY_ENTITY_TYPES.operator,
    entityId: operator.id,
    valuesAfter: { legalName: input.legalName, tradingName: input.tradingName },
  });
  await recordAdminActivity(tx, {
    ...logEntry,
    entityType: ACTIVITY_ENTITY_TYPES.user,
    entityId: user.id,
    valuesAfter: { email: input.userEmail, fullName: input.userFullName },
  });

  const invite = await issueInvite(tx, {
    operatorId: operator.id,
    userId: user.id,
    adminUserId,
    issuedAt: createdAt,
  });

  return { operatorId: operator.id, invite };
}
