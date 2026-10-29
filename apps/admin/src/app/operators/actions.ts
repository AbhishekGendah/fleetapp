"use server";

import { describeErrorForLog, formTextValues } from "@fleetapp/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { operatorDependencies } from "../../lib/operator-dependencies";
import { createOperator } from "../../lib/operators/create-operator";
import { isOperatorActionError } from "../../lib/operators/errors";
import { createOperatorInputSchema } from "../../lib/operators/operator-input";
import { resendInvite } from "../../lib/operators/resend-invite";
import { reactivateOperator, suspendOperator } from "../../lib/operators/suspension";
import { requireAdmin } from "../../lib/require-admin";
import { INVITE_RESULT_PARAM, INVITE_RESULTS } from "./invite-result";
import { OPERATORS_PATH, operatorPath } from "../../lib/paths";

const UNEXPECTED_ERROR_MESSAGE = "Something went wrong. Nothing was changed; try again.";

export interface ActionState {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  /** What was typed, so a refused form comes back filled in rather than empty. */
  values?: Record<string, string>;
}

const CREATE_OPERATOR_FIELDS = ["legalName", "tradingName", "userFullName", "userEmail"] as const;

const operatorIdSchema = z.object({ operatorId: z.uuid() });

function inviteResultPath(operatorId: string, isInviteSent: boolean): string {
  const result = isInviteSent ? INVITE_RESULTS.sent : INVITE_RESULTS.notSent;
  return `${operatorPath(operatorId)}?${INVITE_RESULT_PARAM}=${result}`;
}

/** Shows a refusal as it is; anything unexpected is logged, never shown. */
function toActionState(error: unknown): ActionState {
  if (isOperatorActionError(error)) {
    return { formError: error.message };
  }
  console.error("An Operator action failed", describeErrorForLog(error));
  return { formError: UNEXPECTED_ERROR_MESSAGE };
}

export async function createOperatorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();

  const values = formTextValues(formData, CREATE_OPERATOR_FIELDS);
  const parsed = createOperatorInputSchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  let destination: string;
  try {
    const result = await createOperator(operatorDependencies, admin.id, parsed.data);
    destination = inviteResultPath(result.operatorId, result.isInviteSent);
  } catch (error) {
    return { ...toActionState(error), values };
  }

  revalidatePath(OPERATORS_PATH);
  // Outside the try: redirect() works by throwing.
  redirect(destination);
}

type OperatorAction = (adminUserId: string, operatorId: string) => Promise<string>;

/** The shared shape of the buttons on an Operator's page. */
async function runOperatorAction(formData: FormData, action: OperatorAction): Promise<ActionState> {
  const admin = await requireAdmin();

  const parsed = operatorIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { formError: UNEXPECTED_ERROR_MESSAGE };
  }

  let destination: string;
  try {
    destination = await action(admin.id, parsed.data.operatorId);
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath(OPERATORS_PATH);
  revalidatePath(operatorPath(parsed.data.operatorId));
  redirect(destination);
}

export async function resendInviteAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runOperatorAction(formData, async (adminUserId, operatorId) => {
    const result = await resendInvite(operatorDependencies, adminUserId, operatorId);
    return inviteResultPath(operatorId, result.isInviteSent);
  });
}

export async function suspendOperatorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runOperatorAction(formData, async (adminUserId, operatorId) => {
    await suspendOperator(operatorDependencies, adminUserId, operatorId);
    return operatorPath(operatorId);
  });
}

export async function reactivateOperatorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runOperatorAction(formData, async (adminUserId, operatorId) => {
    await reactivateOperator(operatorDependencies, adminUserId, operatorId);
    return operatorPath(operatorId);
  });
}
