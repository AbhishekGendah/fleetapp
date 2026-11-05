"use server";

import {
  describeErrorForLog,
  blockAt,
  upcomingWeekStarts,
  formatCents,
  formTextValues,
  isRecordId,
  type EndChangeProblem,
} from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { revalidatePath } from "next/cache";

import type { ActingUser } from "../../../lib/acting-user";
import { appDb } from "../../../lib/app-db";
import { signingLinkNotSentState } from "../../../lib/contracts/signing-link-messages";
import { rentalPath } from "../../../lib/paths";
import {
  END_CHANGE_FIELDS,
  endChangeFormSchema,
  ONGOING_CHANGE_FIELDS,
  ongoingChangeFormSchema,
  RATE_CHANGE_FIELDS,
  rateChangeFormSchema,
} from "../../../lib/rentals/change-input";
import {
  changeWeeklyRate,
  sendChangeForSigning,
  cancelChangeLink,
  withdrawChange,
  type RateChangeSendResult,
} from "../../../lib/rentals/change-signing";
import { changeRentalEnd, type EndChangeResult } from "../../../lib/rentals/rental-changes";
import { loadRental } from "../../../lib/rentals/rental-queries";
import { appLinkDependencies } from "../../../lib/renter-links/app-link-dependencies";
import { linkSentState, type LinkSendState } from "../../../lib/renter-links/link-send-state";
import type { SignedInUser } from "../../../lib/require-user";
import { requireUser } from "../../../lib/require-user";
import { runUserChange } from "../../../lib/run-change";

// The browser runs the same checks first, so this is only reached by a request that skipped them.
const INVALID_MESSAGE =
  "Some details are not right, so nothing was saved. Check them and try again.";
const NOT_FOUND_MESSAGE = "That rental could not be found.";
const SEND_FAILED_MESSAGE = "The change could not be sent. Try again in a moment.";

const END_REFUSALS: Record<Exclude<EndChangeResult["status"], "changed" | "clash">, string> &
  Record<EndChangeProblem, string> = {
  not_found: NOT_FOUND_MESSAGE,
  not_changeable: "Only a booked rental, or one that is out, can change its end.",
  return_under_way: "A return is under way. Finish or cancel it first.",
  in_past: "The new end must be in the future. If the car is back, do the return instead.",
  before_start: "The new end must be after the start.",
  unchanged: "That is the end it has already.",
  short_hire_ongoing:
    "A short hire can't become ongoing once the car is out. Give it an end date, or book a long-term rental.",
};

const RATE_REFUSALS: Record<
  Exclude<
    RateChangeSendResult["status"],
    | "sent"
    | "missing"
    | "not_signable"
    | "no_email"
    | "renter_archived"
    | "no_template"
    | "already_signed"
  >,
  string
> = {
  not_found: NOT_FOUND_MESSAGE,
  not_changeable: "The weekly rate can change once the car is out.",
  return_under_way: "A return is under way. Finish or cancel it first.",
  one_waiting: "A rate change is already waiting for the Renter. Withdraw it first.",
  too_soon: "That rent week has started. Choose a later one.",
  unchanged: "That week already has that weekly rate.",
  not_long_term: "Only a long-term rental's weekly rate can change.",
  not_week_start: "A new rate starts at the beginning of a rent week.",
  already_has_rate: "That week already has a signed rate. Choose a later week.",
};

function changeRental(
  rentalId: string,
  description: string,
  change: (actor: ActingUser, user: SignedInUser) => Promise<ChangeFormState>,
): Promise<ChangeFormState> {
  if (!isRecordId(rentalId)) {
    return Promise.resolve(failedState(NOT_FOUND_MESSAGE));
  }
  return runUserChange({ description, pagesToRefresh: [rentalPath(rentalId)], change });
}

/** What the end change came back with, in words; a short-notice end is saved with a warning. */
function endChangeState(result: EndChangeResult): ChangeFormState {
  if (result.status === "changed") {
    return result.noticeDaysShort > 0
      ? savedState(
          `Saved. That gives ${result.noticeDaysShort} ${result.noticeDaysShort === 1 ? "day" : "days"} less notice than your terms ask; it is noted in the Log.`,
          true,
        )
      : savedState("Saved.");
  }
  if (result.status === "clash") {
    return failedState(
      "Another booking has the car for part of that time. Move or cancel it first, or choose an earlier end.",
      result.clash
        ? { href: rentalPath(result.clash.rentalId), label: "Open that booking" }
        : undefined,
    );
  }
  return failedState(END_REFUSALS[result.status]);
}

export async function changeEndAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const values = formTextValues(formData, END_CHANGE_FIELDS);
  return changeRental(rentalId, "Changing a rental's end", async (actor, user) => {
    const parsed = endChangeFormSchema(user.operatorTimezone).safeParse(values);
    if (!parsed.success) {
      return failedState(INVALID_MESSAGE);
    }
    const clock = { timeZone: user.operatorTimezone, now: new Date() };
    return endChangeState(await changeRentalEnd(appDb, actor, rentalId, parsed.data, clock));
  });
}

export async function makeOngoingAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = ongoingChangeFormSchema.safeParse(formTextValues(formData, ONGOING_CHANGE_FIELDS));
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return changeRental(rentalId, "Making a rental ongoing", async (actor, user) => {
    const clock = { timeZone: user.operatorTimezone, now: new Date() };
    const request = { newEnd: null, reason: parsed.data.reason };
    return endChangeState(await changeRentalEnd(appDb, actor, rentalId, request, clock));
  });
}

type RateRefusal = Extract<RateChangeSendResult, { status: keyof typeof RATE_REFUSALS }>;

function isRateRefusal(result: RateChangeSendResult): result is RateRefusal {
  return Object.hasOwn(RATE_REFUSALS, result.status);
}

function rateChangeState(result: RateChangeSendResult, rateText: string): ChangeFormState {
  if (result.status === "sent") {
    return savedState(
      result.isEmailed
        ? `Sent to the Renter to sign. ${rateText} a week starts once they sign.`
        : "Saved, but the email did not go. Use Send again on the change below.",
      !result.isEmailed,
    );
  }
  if (isRateRefusal(result)) {
    return failedState(RATE_REFUSALS[result.status]);
  }
  const notSent = signingLinkNotSentState(result, "change of terms");
  return failedState(notSent.status === "failed" ? notSent.message : SEND_FAILED_MESSAGE);
}

/**
 * The rent weeks a posted rate change may start with. Wider than the form
 * offers, so a form opened just before a week began still passes; the
 * change's own rules refuse a week already under way.
 */
const RATE_CHANGE_WEEKS_CHECKED = 9;

export async function changeRateAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const values = formTextValues(formData, RATE_CHANGE_FIELDS);
  return changeRental(rentalId, "Changing a rental's weekly rate", async (actor, user) => {
    const clock = { timeZone: user.operatorTimezone, now: new Date() };
    const rental = await loadRental(appDb, actor.operatorId, rentalId, clock);
    if (!rental?.handedOverAt) {
      return failedState(NOT_FOUND_MESSAGE);
    }
    const weekStarts = upcomingWeekStarts(
      blockAt(rental.handedOverAt, clock.now),
      RATE_CHANGE_WEEKS_CHECKED,
    );
    const parsed = rateChangeFormSchema(weekStarts).safeParse(values);
    if (!parsed.success) {
      return failedState(INVALID_MESSAGE);
    }
    const result = await changeWeeklyRate(
      appLinkDependencies(user.operatorTimezone),
      actor,
      rentalId,
      parsed.data,
      clock,
    );
    return rateChangeState(result, formatCents(parsed.data.weeklyRateCents));
  });
}

export async function withdrawChangeAction(
  rentalId: string,
  changeId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(changeId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return changeRental(rentalId, "Withdrawing a change of terms", async (actor) =>
    (await withdrawChange(appDb, actor, changeId, new Date())) === "withdrawn"
      ? savedState("Withdrawn. The link no longer works.")
      : failedState("Only a change still waiting for the Renter can be withdrawn."),
  );
}

/** Stops a change's form link working; the change itself stays as it is (review A3-3). */
export async function cancelChangeLinkAction(
  rentalId: string,
  changeId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(changeId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return changeRental(rentalId, "Cancelling a change form's link", async (actor) =>
    (await cancelChangeLink(appDb, actor, changeId, new Date())) === "cancelled"
      ? savedState("Link cancelled.")
      : failedState("There is no link to cancel."),
  );
}

/** Sends (or sends again) a change's form for the Renter to sign. */
export async function sendChangeAction(
  rentalId: string,
  changeId: string,
  _previous: LinkSendState,
): Promise<LinkSendState> {
  const user = await requireUser();
  if (!isRecordId(rentalId) || !isRecordId(changeId)) {
    return { status: "failed", message: NOT_FOUND_MESSAGE };
  }
  try {
    const result = await sendChangeForSigning(
      appLinkDependencies(user.operatorTimezone),
      { userId: user.id, operatorId: user.operatorId },
      changeId,
      { timeZone: user.operatorTimezone, now: new Date() },
    );
    revalidatePath(rentalPath(rentalId));
    return result.status === "sent"
      ? linkSentState(result, user.operatorTimezone)
      : signingLinkNotSentState(result, "change of terms");
  } catch (error) {
    // Never the error's details: they could hold the link's address.
    console.error("Sending a change of terms failed", describeErrorForLog(error));
    return { status: "failed", message: SEND_FAILED_MESSAGE };
  }
}
