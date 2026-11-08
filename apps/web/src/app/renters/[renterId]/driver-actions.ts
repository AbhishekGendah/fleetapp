"use server";

import {
  describeErrorForLog,
  formTextValues,
  isRecordId,
  todayInTimeZone,
  type DriverToAddProblem,
} from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import type { ActingUser } from "../../../lib/acting-user";
import { appDb } from "../../../lib/app-db";
import { appEmailSender } from "../../../lib/email-sender";
import { renterPath, RENTERS_PATH } from "../../../lib/paths";
import { sendPrivacyNotice } from "../../../lib/privacy/send-privacy-notice";
import { appLinkDependencies } from "../../../lib/renter-links/app-link-dependencies";
import { sendDetailsLink } from "../../../lib/renter-links/details-links";
import type { SignedInUser } from "../../../lib/require-user";
import { ADD_DRIVER_FIELDS, parseAddDriverForm } from "../../../lib/renters/driver-input";
import {
  addExistingDriver,
  addNewDriver,
  removeDriver,
  type AddDriverResult,
} from "../../../lib/renters/organisation-driver-records";
import { runUserChange } from "../../../lib/run-change";
import { loadOperatorSettings } from "../../../lib/settings/operator-settings";
import { RENTER_NOT_FOUND_MESSAGE } from "../renter-form-state";

const INVALID_MESSAGE = "That is not right, so nothing was saved. Check it and try again.";

/** Why someone can't be added as a driver, in the Operator's words (the database refuses the same). */
const PROBLEM_MESSAGES: Readonly<Record<DriverToAddProblem, string>> = {
  not_a_person: "A business can't drive for another business. Pick a person.",
  details_removed:
    "That Renter's details were removed seven years on. Add them again as someone new.",
  archived: "That Renter is archived. Restore them on their page first, then add them here.",
  do_not_rent: "That Renter is marked Do not rent, so they can't drive for a business.",
  already_a_driver: "They already drive for this business.",
};

const NAMED_ON_RENTAL_MESSAGE =
  "They are named on a draft, booking or car out of this business. Name someone else on it, or finish or cancel it, first.";

function refusalOf(result: AddDriverResult): ChangeFormState | null {
  switch (result.status) {
    case "added":
      return null;
    case "refused":
      return failedState(PROBLEM_MESSAGES[result.problem]);
    case "business_not_found":
      return failedState(RENTER_NOT_FOUND_MESSAGE);
    case "driver_not_found":
      return failedState("That Renter could not be found. Pick them again.");
  }
}

/**
 * A new driver gets their details link (their licence and photos come from
 * them, plan decision 11), when they have an email: the link's codes go
 * there. Saving the driver never waits on it.
 */
async function sendLinkToNewDriver(
  user: SignedInUser,
  actor: ActingUser,
  driverId: string,
): Promise<"sent" | "no_email" | "not_sent"> {
  try {
    const settings = await loadOperatorSettings(appDb, actor.operatorId);
    const result = await sendDetailsLink(
      appLinkDependencies(user.operatorTimezone),
      actor,
      driverId,
      settings.renterLinkValidDays,
    );
    if (result.status === "sent") {
      return result.isEmailed ? "sent" : "not_sent";
    }
    return result.status === "no_email" ? "no_email" : "not_sent";
  } catch (error) {
    // Never the error's details: they could hold the link's address.
    console.error("Sending a new driver's details link failed", describeErrorForLog(error));
    return "not_sent";
  }
}

const NEW_DRIVER_SAVED: Readonly<Record<"sent" | "no_email" | "not_sent", string>> = {
  sent: "Driver added. Their details link is on its way to their email.",
  no_email:
    "Driver added. Add their email on their page to send the details link: its codes go by email.",
  not_sent: "Driver added, but the details link could not be sent. Send it from their page.",
};

/** Adds a driver to the business: someone already a Renter, or someone new. */
export async function addDriverAction(
  organisationId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  if (!isRecordId(organisationId)) {
    return failedState(RENTER_NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Adding a driver to a business",
    pagesToRefresh: [renterPath(organisationId), RENTERS_PATH],
    change: async (actor, user) => {
      const parsed = parseAddDriverForm(
        formTextValues(formData, ADD_DRIVER_FIELDS),
        todayInTimeZone(new Date(), user.operatorTimezone),
      );
      if (!parsed.success) {
        return failedState(INVALID_MESSAGE);
      }
      const input = parsed.data;
      const result =
        input.source === "existing"
          ? await addExistingDriver(appDb, actor, organisationId, input.driverId)
          : await addNewDriver(appDb, actor, organisationId, input.person);
      const refusal = refusalOf(result);
      if (refusal || result.status !== "added") {
        return refusal ?? failedState(INVALID_MESSAGE);
      }
      // They are told what the business sees about them (APP 5), new or not.
      const deps = { database: appDb, emailSender: appEmailSender };
      await sendPrivacyNotice(deps, actor, result.driverId);
      if (input.source === "existing") {
        return savedState("Driver added.");
      }
      const link = await sendLinkToNewDriver(user, actor, result.driverId);
      return savedState(NEW_DRIVER_SAVED[link], link !== "sent");
    },
  });
}

/** Ends a driver's link to the business; refused while a rental of it names them. */
export async function removeDriverAction(
  organisationId: string,
  driverId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(organisationId) || !isRecordId(driverId)) {
    return failedState(RENTER_NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Removing a driver from a business",
    pagesToRefresh: [renterPath(organisationId), renterPath(driverId), RENTERS_PATH],
    change: async (actor) => {
      const result = await removeDriver(appDb, actor, organisationId, driverId);
      if (result === "named_on_rental") {
        return failedState(NAMED_ON_RENTAL_MESSAGE);
      }
      return result === "removed"
        ? savedState("Driver removed. Their past rentals stay as they were.")
        : failedState("They are no longer a driver of this business.");
    },
  });
}
